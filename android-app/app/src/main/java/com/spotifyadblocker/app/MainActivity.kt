package com.spotifyadblocker.app

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.view.inputmethod.InputMethodManager
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
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
import android.view.ViewGroup
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updateLayoutParams
import androidx.core.view.updatePadding
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

    private val fabHandler = Handler(Looper.getMainLooper())
    private val hideFabRunnable = Runnable {
        if (::fabControllerMenu.isInitialized) {
            fabControllerMenu.animate()
                .alpha(0f)
                .setDuration(400)
                .withEndAction {
                    fabControllerMenu.visibility = View.GONE
                }
                .start()
        }
    }

    fun showFabTemporarily() {
        fabHandler.removeCallbacks(hideFabRunnable)
        if (::fabControllerMenu.isInitialized) {
            if (fabControllerMenu.visibility != View.VISIBLE) {
                fabControllerMenu.visibility = View.VISIBLE
                fabControllerMenu.alpha = 0f
            }
            fabControllerMenu.animate()
                .alpha(1f)
                .setDuration(250)
                .start()
            fabHandler.postDelayed(hideFabRunnable, 3500)
        }
    }

    override fun dispatchTouchEvent(ev: MotionEvent?): Boolean {
        if (ev?.action == MotionEvent.ACTION_DOWN) {
            showFabTemporarily()
        }
        return super.dispatchTouchEvent(ev)
    }

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

    class AndroidBridge(private val activity: MainActivity) {
        @JavascriptInterface
        fun showKeyboard() {
            activity.forceShowKeyboard()
        }

        @JavascriptInterface
        fun openSettings() {
            activity.runOnUiThread {
                activity.showFabTemporarily()
                activity.showControllerDialog()
            }
        }
    }

    fun forceShowKeyboard() {
        runOnUiThread {
            val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
            imm.showSoftInput(webView, 0)
        }
    }

    @SuppressLint("SetJavaScriptEnabled", "ClickableViewAccessibility")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // Ensure soft input mode and clear flags preventing IME focus on Xiaomi HyperOS
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        window.clearFlags(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_ALT_FOCUSABLE_IM)

        // Enable Chrome DevTools remote debugging
        WebView.setWebContentsDebuggingEnabled(true)

        otaSyncManager = OtaSyncManager(this)

        webView = findViewById(R.id.webView)
        pageProgressBar = findViewById(R.id.pageProgressBar)
        fabControllerMenu = findViewById(R.id.fabControllerMenu)

        // Squeeze WebView so bottom menus and navigation bars sit cleanly above Android navigation buttons
        ViewCompat.setOnApplyWindowInsetsListener(webView) { view, insets ->
            val navBars = insets.getInsets(WindowInsetsCompat.Type.navigationBars())
            view.updateLayoutParams<ViewGroup.MarginLayoutParams> {
                bottomMargin = navBars.bottom
            }
            insets
        }

        webView.addJavascriptInterface(AndroidBridge(this), "AndroidBridge")

        // Ensure touch focus for soft keyboard (fixes Xiaomi / MIUI / HyperOS IME issue)
        webView.isFocusable = true
        webView.isFocusableInTouchMode = true
        webView.requestFocus(View.FOCUS_DOWN)

        // Persist login session cookies across open.spotify.com and accounts.spotify.com
        try {
            val cookieManager = CookieManager.getInstance()
            cookieManager.setAcceptCookie(true)
            cookieManager.setAcceptThirdPartyCookies(webView, true)
        } catch (e: Exception) {
            e.printStackTrace()
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
                webView.evaluateJavascript("window.__sab_handle_back ? window.__sab_handle_back() : (window.__sab_close_library ? window.__sab_close_library() : false)") { result ->
                    if (result != "true") {
                        if (webView.canGoBack()) {
                            webView.goBack()
                        } else {
                            finish()
                        }
                    }
                }
            }
        })

        // Floating Action Button to open Controller Menu & OTA Sync
        fabControllerMenu.setOnClickListener {
            showFabTemporarily()
            showControllerDialog()
        }

        // Show FAB briefly on startup, auto-hides after 3.5s
        showFabTemporarily()

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
            // Native mobile view: pure native mobile Spotify experience (bottom nav, mobile search, native keyboard)
            settings.userAgentString = null
            settings.useWideViewPort = false
            settings.loadWithOverviewMode = false
        }

        settings.textZoom = 100
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW

        // Ensure session and auth cookies persist across app restarts
        try {
            val cookieManager = android.webkit.CookieManager.getInstance()
            cookieManager.setAcceptCookie(true)
            cookieManager.setAcceptThirdPartyCookies(webView, true)
        } catch (e: Exception) {
            e.printStackTrace()
        }
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
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false

                // Block deep links that try to open the native Spotify app or Play Store
                if (url.startsWith("spotify:") || url.startsWith("intent:") || url.contains("spotify.link") || url.contains("app.adjust.com")) {
                    return true
                }

                // Allow Spotify Web Player and Spotify Login (accounts.spotify.com) inside the WebView
                return false
            }

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
                try {
                    CookieManager.getInstance().flush()
                } catch (e: Exception) {
                    e.printStackTrace()
                }
                injectCustomStylesAndClasses()
                syncConfigToWebView()

                // Ensure tapping <input> on both open.spotify.com AND accounts.spotify.com pops up the keyboard on HyperOS
                view?.evaluateJavascript(
                    """
                    (function() {
                        if (window.__sab_kb_bound) return;
                        window.__sab_kb_bound = true;
                        function triggerKb(e) {
                            var el = e.target;
                            if (!el) return;
                            var tag = el.tagName ? el.tagName.toUpperCase() : '';
                            if (tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable || el.getAttribute('role') === 'searchbox') {
                                if (window.AndroidBridge && typeof window.AndroidBridge.showKeyboard === 'function') {
                                    window.AndroidBridge.showKeyboard();
                                }
                            }
                        }
                        document.addEventListener('touchend', triggerKb, true);
                        document.addEventListener('focusin', triggerKb, true);
                        document.addEventListener('click', triggerKb, true);
                    })();
                    """.trimIndent(),
                    null
                )
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

                    // Enforce mobile-friendly viewport meta tag
                    var meta = document.querySelector('meta[name="viewport"]');
                    if (!meta) {
                        meta = document.createElement('meta');
                        meta.name = 'viewport';
                        (document.head || document.documentElement).appendChild(meta);
                    }
                    if (!$desktopView) {
                        meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
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
            webView.evaluateJavascript("window.sabOpenLibrary ? window.sabOpenLibrary() : (location.href = 'https://open.spotify.com/collection/tracks')") { }
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
