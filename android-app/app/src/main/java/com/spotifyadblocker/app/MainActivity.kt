package com.spotifyadblocker.app

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.os.Bundle
import android.view.MotionEvent
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.google.android.material.button.MaterialButton
import com.google.android.material.floatingactionbutton.FloatingActionButton
import com.google.android.material.switchmaterial.SwitchMaterial
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.util.concurrent.CopyOnWriteArrayList

class MainActivity : AppCompatActivity() {

    private lateinit var webView: AudioWebView
    private lateinit var pageProgressBar: ProgressBar
    private lateinit var fabControllerMenu: FloatingActionButton
    private lateinit var otaSyncManager: OtaSyncManager

    private var documentStartScriptHandler: ScriptHandler? = null
    private val blockedUrlPatterns = CopyOnWriteArrayList<String>()

    private val PREFS_NAME = "sab_spotify_prefs"
    private val KEY_DESKTOP_VIEW = "desktopViewEnabled"
    private val KEY_UNLOCK_CONTROLS = "unlockControls"
    private val KEY_CUSTOM_QUEUE = "customQueueEnabled"
    private val KEY_MUTE_ADS = "muteAds"
    private val KEY_FAST_FORWARD = "fastForwardAds"
    private val KEY_HIDE_BANNERS = "hideBanners"

    private val DESKTOP_USER_AGENT =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"

    @SuppressLint("SetJavaScriptEnabled", "ClickableViewAccessibility")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // Enable Chrome DevTools remote debugging
        WebView.setWebContentsDebuggingEnabled(true)

        otaSyncManager = OtaSyncManager(this)

        webView = findViewById(R.id.webView)
        pageProgressBar = findViewById(R.id.pageProgressBar)
        fabControllerMenu = findViewById(R.id.fabControllerMenu)

        // Ensure touch focus for soft keyboard (fixes Xiaomi / MIUI / HyperOS IME issue)
        webView.isFocusable = true
        webView.isFocusableInTouchMode = true
        webView.requestFocus(View.FOCUS_DOWN)

        webView.setOnTouchListener { v, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN, MotionEvent.ACTION_UP -> {
                    if (!v.hasFocus()) {
                        v.requestFocusFromTouch()
                    }
                }
            }
            false
        }

        // Start background media foreground service to prevent audio suspension
        MediaPlaybackService.start(this)

        // Load active declarative network rules into memory
        reloadNetworkRules()

        // Configure WebView settings (Mobile-first by default to eliminate horizontal dragging)
        configureWebSettings()

        // Set up document_start JavaScript injection
        registerDocumentStartHook()

        // Configure WebChromeClient for DRM & progress
        configureWebChromeClient()

        // Configure WebViewClient for ad interception & CSS injection
        configureWebViewClient()

        // Handle system back gestures
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    finish()
                }
            }
        })

        // Floating Action Button to open Controller Menu & OTA Sync
        fabControllerMenu.setOnClickListener {
            showControllerDialog()
        }

        // Load Spotify Web Player
        webView.loadUrl("https://open.spotify.com")

        // Perform background OTA check on app launch
        triggerBackgroundOtaSync(showToastOnNoChange = false)
    }

    private fun configureWebSettings() {
        val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        val desktopView = prefs.getBoolean(KEY_DESKTOP_VIEW, false)

        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false

        if (desktopView) {
            settings.userAgentString = DESKTOP_USER_AGENT
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true
        } else {
            // Native mobile view: fits phone screen naturally without horizontal dragging
            settings.userAgentString = null
            settings.useWideViewPort = false
            settings.loadWithOverviewMode = false
        }

        settings.textZoom = 100
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
    }

    private fun registerDocumentStartHook() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            return
        }

        val pageHookCode = otaSyncManager.getFileContent(
            OtaSyncManager.OTA_PAGE_HOOK,
            OtaSyncManager.FALLBACK_PAGE_HOOK
        )

        try {
            documentStartScriptHandler?.remove()
            documentStartScriptHandler = WebViewCompat.addDocumentStartJavaScript(
                webView,
                pageHookCode,
                setOf("https://open.spotify.com")
            )
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun reloadNetworkRules() {
        blockedUrlPatterns.clear()
        val rulesJsonText = otaSyncManager.getFileContent(
            OtaSyncManager.OTA_RULES,
            OtaSyncManager.FALLBACK_RULES
        )

        try {
            val jsonArray = JSONArray(rulesJsonText)
            for (i in 0 until jsonArray.length()) {
                val rule = jsonArray.optJSONObject(i) ?: continue
                val condition = rule.optJSONObject("condition") ?: continue
                val urlFilter = condition.optString("urlFilter", "")
                if (urlFilter.isNotEmpty()) {
                    val cleaned = urlFilter.replace("||", "").replace("^", "").trim()
                    if (cleaned.isNotEmpty()) {
                        blockedUrlPatterns.add(cleaned)
                    }
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }

        val fallbackDomains = listOf(
            "doubleclick.net",
            "googlesyndication.com",
            "googleadservices.com",
            "adeventtracker.spotify.com",
            "ads-fa.spotify.com",
            "crashdump.spotify.com"
        )
        for (domain in fallbackDomains) {
            if (!blockedUrlPatterns.contains(domain)) {
                blockedUrlPatterns.add(domain)
            }
        }
    }

    private fun configureWebChromeClient() {
        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                val requestedResources = request.resources
                if (requestedResources.contains(PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID)) {
                    request.grant(arrayOf(PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID))
                } else {
                    request.deny()
                }
            }

            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                if (newProgress < 100) {
                    pageProgressBar.visibility = View.VISIBLE
                    pageProgressBar.progress = newProgress
                } else {
                    pageProgressBar.visibility = View.GONE
                }
            }
        }
    }

    private fun configureWebViewClient() {
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView?,
                request: WebResourceRequest?
            ): WebResourceResponse? {
                val url = request?.url?.toString() ?: return null

                for (pattern in blockedUrlPatterns) {
                    if (url.contains(pattern, ignoreCase = true)) {
                        val responseHeaders = mutableMapOf(
                            "Access-Control-Allow-Origin" to "*",
                            "Access-Control-Allow-Methods" to "GET, POST, OPTIONS",
                            "Access-Control-Allow-Headers" to "*"
                        )

                        val isJson = url.contains(".json") || request.requestHeaders["Accept"]?.contains("json") == true
                        val mimeType = if (isJson) "application/json" else "text/plain"
                        val responseBody = if (isJson) "{}" else ""

                        return WebResourceResponse(
                            mimeType,
                            "UTF-8",
                            200,
                            "OK",
                            responseHeaders,
                            ByteArrayInputStream(responseBody.toByteArray(Charsets.UTF_8))
                        )
                    }
                }

                return super.shouldInterceptRequest(view, request)
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                injectCustomStylesAndClasses()
                syncConfigToWebView()
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                injectCustomStylesAndClasses()
                syncConfigToWebView()
            }
        }
    }

    private fun injectCustomStylesAndClasses() {
        val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        val desktopView = prefs.getBoolean(KEY_DESKTOP_VIEW, false)

        val css = otaSyncManager.getFileContent(
            OtaSyncManager.OTA_STYLES,
            OtaSyncManager.FALLBACK_STYLES
        )

        val escapedCss = JSONObject.quote(css)
        val js = """
            (function() {
                try {
                    // Inject responsive & ad blocking CSS
                    var styleEl = document.getElementById('sab-injected-css');
                    if (!styleEl) {
                        styleEl = document.createElement('style');
                        styleEl.id = 'sab-injected-css';
                        (document.head || document.documentElement).appendChild(styleEl);
                    }
                    styleEl.textContent = $escapedCss;

                    document.documentElement.classList.add('sab-hide-banners', 'sab-unlock-controls');
                    if (!$desktopView) {
                        document.documentElement.classList.add('sab-mobile-fit');
                    } else {
                        document.documentElement.classList.remove('sab-mobile-fit');
                    }
                } catch(e) {}
            })();
        """.trimIndent()

        webView.evaluateJavascript(js, null)
    }

    private fun syncConfigToWebView() {
        val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        val unlockControls = prefs.getBoolean(KEY_UNLOCK_CONTROLS, true)
        val customQueueEnabled = prefs.getBoolean(KEY_CUSTOM_QUEUE, true)
        val muteAds = prefs.getBoolean(KEY_MUTE_ADS, true)
        val fastForwardAds = prefs.getBoolean(KEY_FAST_FORWARD, true)
        val hideBanners = prefs.getBoolean(KEY_HIDE_BANNERS, true)

        val configJson = JSONObject().apply {
            put("unlockControls", unlockControls)
            put("customQueueEnabled", customQueueEnabled)
            put("muteAds", muteAds)
            put("fastForwardAds", fastForwardAds)
            put("hideBanners", hideBanners)
        }.toString()

        val escapedPayload = JSONObject.quote(configJson)
        val js = """
            (function() {
                try {
                    window.dispatchEvent(new CustomEvent('SpotifyAdBlocker:Config', {
                        detail: $escapedPayload
                    }));
                } catch(e) {}
            })();
        """.trimIndent()

        webView.evaluateJavascript(js, null)
    }

    private fun triggerBackgroundOtaSync(showToastOnNoChange: Boolean) {
        lifecycleScope.launch {
            otaSyncManager.syncFromGitHub { updatedFiles, isChanged, errorMsg ->
                if (isChanged) {
                    reloadNetworkRules()
                    registerDocumentStartHook()
                    webView.reload()
                    Toast.makeText(
                        this@MainActivity,
                        "Updated from GitHub! (${updatedFiles.joinToString()})",
                        Toast.LENGTH_LONG
                    ).show()
                } else if (showToastOnNoChange) {
                    if (errorMsg != null) {
                        Toast.makeText(this@MainActivity, "Sync note: $errorMsg", Toast.LENGTH_SHORT).show()
                    } else {
                        Toast.makeText(this@MainActivity, "All scripts are up to date with GitHub!", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        }
    }

    private fun showControllerDialog() {
        val dialog = BottomSheetDialog(this)
        val view = layoutInflater.inflate(R.layout.dialog_controls, null)
        dialog.setContentView(view)

        val tvOtaStatus = view.findViewById<TextView>(R.id.tvOtaStatus)
        val btnSync = view.findViewById<MaterialButton>(R.id.btnSyncGithub)
        val btnReload = view.findViewById<MaterialButton>(R.id.btnReloadPage)
        val btnClose = view.findViewById<MaterialButton>(R.id.btnCloseDialog)

        val btnHome = view.findViewById<MaterialButton>(R.id.btnNavHome)
        val btnSearch = view.findViewById<MaterialButton>(R.id.btnNavSearch)
        val btnLibrary = view.findViewById<MaterialButton>(R.id.btnNavLibrary)

        val swMobileFit = view.findViewById<SwitchMaterial>(R.id.switchMobileFit)
        val swUnlock = view.findViewById<SwitchMaterial>(R.id.switchUnlockControls)
        val swQueue = view.findViewById<SwitchMaterial>(R.id.switchCustomQueue)
        val swMute = view.findViewById<SwitchMaterial>(R.id.switchMuteAds)
        val swFast = view.findViewById<SwitchMaterial>(R.id.switchFastForward)
        val swBanners = view.findViewById<SwitchMaterial>(R.id.switchHideBanners)

        val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        val desktopView = prefs.getBoolean(KEY_DESKTOP_VIEW, false)
        swMobileFit.isChecked = !desktopView
        swUnlock.isChecked = prefs.getBoolean(KEY_UNLOCK_CONTROLS, true)
        swQueue.isChecked = prefs.getBoolean(KEY_CUSTOM_QUEUE, true)
        swMute.isChecked = prefs.getBoolean(KEY_MUTE_ADS, true)
        swFast.isChecked = prefs.getBoolean(KEY_FAST_FORWARD, true)
        swBanners.isChecked = prefs.getBoolean(KEY_HIDE_BANNERS, true)

        val otaHookFile = java.io.File(filesDir, OtaSyncManager.OTA_PAGE_HOOK)
        if (otaHookFile.exists()) {
            val date = java.text.SimpleDateFormat("MMM dd, HH:mm", java.util.Locale.getDefault())
                .format(java.util.Date(otaHookFile.lastModified()))
            tvOtaStatus.text = "Using cached GitHub OTA scripts (Updated: $date)"
        } else {
            tvOtaStatus.text = "Using pre-bundled APK fallback scripts"
        }

        fun saveAndSync() {
            val wasDesktop = prefs.getBoolean(KEY_DESKTOP_VIEW, false)
            val nowDesktop = !swMobileFit.isChecked

            prefs.edit()
                .putBoolean(KEY_DESKTOP_VIEW, nowDesktop)
                .putBoolean(KEY_UNLOCK_CONTROLS, swUnlock.isChecked)
                .putBoolean(KEY_CUSTOM_QUEUE, swQueue.isChecked)
                .putBoolean(KEY_MUTE_ADS, swMute.isChecked)
                .putBoolean(KEY_FAST_FORWARD, swFast.isChecked)
                .putBoolean(KEY_HIDE_BANNERS, swBanners.isChecked)
                .apply()

            if (wasDesktop != nowDesktop) {
                configureWebSettings()
                webView.reload()
            } else {
                injectCustomStylesAndClasses()
                syncConfigToWebView()
            }
        }

        swMobileFit.setOnCheckedChangeListener { _, _ -> saveAndSync() }
        swUnlock.setOnCheckedChangeListener { _, _ -> saveAndSync() }
        swQueue.setOnCheckedChangeListener { _, _ -> saveAndSync() }
        swMute.setOnCheckedChangeListener { _, _ -> saveAndSync() }
        swFast.setOnCheckedChangeListener { _, _ -> saveAndSync() }
        swBanners.setOnCheckedChangeListener { _, _ -> saveAndSync() }

        btnHome.setOnClickListener {
            webView.loadUrl("https://open.spotify.com/")
            dialog.dismiss()
        }

        btnSearch.setOnClickListener {
            webView.loadUrl("https://open.spotify.com/search")
            dialog.dismiss()
        }

        btnLibrary.setOnClickListener {
            webView.loadUrl("https://open.spotify.com/collection/playlists")
            dialog.dismiss()
        }

        btnSync.setOnClickListener {
            btnSync.isEnabled = false
            btnSync.text = "Checking GitHub..."
            lifecycleScope.launch {
                otaSyncManager.syncFromGitHub { updatedFiles, isChanged, errorMsg ->
                    btnSync.isEnabled = true
                    btnSync.text = "Sync Updates from GitHub"
                    if (isChanged) {
                        dialog.dismiss()
                        reloadNetworkRules()
                        registerDocumentStartHook()
                        webView.reload()
                        Toast.makeText(
                            this@MainActivity,
                            "Updated from GitHub! (${updatedFiles.joinToString()})",
                            Toast.LENGTH_LONG
                        ).show()
                    } else {
                        Toast.makeText(
                            this@MainActivity,
                            errorMsg ?: "All scripts are already up to date!",
                            Toast.LENGTH_SHORT
                        ).show()
                    }
                }
            }
        }

        btnReload.setOnClickListener {
            webView.reload()
            dialog.dismiss()
        }

        btnClose.setOnClickListener {
            dialog.dismiss()
        }

        dialog.show()
    }
}
