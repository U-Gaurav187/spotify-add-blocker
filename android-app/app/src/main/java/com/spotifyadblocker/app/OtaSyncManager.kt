package com.spotifyadblocker.app

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/**
 * Manages Over-The-Air (OTA) synchronization of core WebExtension assets from GitHub Raw
 * to the Android local sandbox with strict integrity checks and cache busting.
 */
class OtaSyncManager(private val context: Context) {

    companion object {
        const val OTA_PAGE_HOOK = "ota_page_hook.js"
        const val OTA_STYLES = "ota_styles.css"
        const val OTA_RULES = "ota_rules.json"
        const val OTA_REMOTE_CONFIG = "ota_remote_config.json"

        const val FALLBACK_PAGE_HOOK = "page_hook.js"
        const val FALLBACK_STYLES = "styles.css"
        const val FALLBACK_RULES = "rules.json"
        const val FALLBACK_REMOTE_CONFIG = "remote-config.json"

        private const val BASE_PRIMARY_URL =
            "https://raw.githubusercontent.com/U-Gaurav187/spotify-add-blocker/main"
        private const val BASE_FALLBACK_URL =
            "https://raw.githubusercontent.com/U-Gaurav187/spotify-add-blocker/master"
    }

    private val httpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    /**
     * Cache-first accessor: Returns the cached OTA file from filesDir if present and non-empty,
     * otherwise falls back to the APK-bundled file in assets/.
     */
    fun getFileContent(otaFileName: String, assetFallbackName: String): String {
        val otaFile = File(context.filesDir, otaFileName)
        if (otaFile.exists() && otaFile.length() > 0) {
            try {
                return otaFile.readText(Charsets.UTF_8)
            } catch (e: Exception) {
                // Fall back to bundled asset if reading fails
            }
        }
        return readBundledAsset(assetFallbackName)
    }

    /**
     * Reads a pre-bundled fallback file from assets.
     */
    fun readBundledAsset(assetName: String): String {
        return try {
            context.assets.open(assetName).bufferedReader(Charsets.UTF_8).use { it.readText() }
        } catch (e: Exception) {
            ""
        }
    }

    /**
     * Fetches all 4 extension assets from GitHub Raw with cache-busting headers,
     * performs integrity verification, detects hot changes, and updates local cache.
     */
    suspend fun syncFromGitHub(
        onComplete: (updatedFiles: List<String>, isChanged: Boolean, errorMsg: String?) -> Unit
    ) = withContext(Dispatchers.IO) {
        val syncTargets = listOf(
            SyncTarget(OTA_PAGE_HOOK, FALLBACK_PAGE_HOOK, "page_hook.js") { content ->
                content.contains("__sab_hook_installed")
            },
            SyncTarget(OTA_STYLES, FALLBACK_STYLES, "styles.css") { content ->
                content.contains("sab-hide-banners")
            },
            SyncTarget(OTA_RULES, FALLBACK_RULES, "rules.json") { content ->
                try {
                    JSONArray(content)
                    true
                } catch (e: Exception) {
                    false
                }
            },
            SyncTarget(OTA_REMOTE_CONFIG, FALLBACK_REMOTE_CONFIG, "remote-config.json") { content ->
                try {
                    JSONObject(content)
                    true
                } catch (e: Exception) {
                    false
                }
            }
        )

        val updatedFiles = mutableListOf<String>()
        var errorEncountered: String? = null

        for (target in syncTargets) {
            try {
                val downloadedContent = fetchWithFallback(target.remoteFileName)
                if (downloadedContent == null) {
                    errorEncountered = "Could not fetch ${target.remoteFileName} (404/Network)"
                    continue
                }

                // Verify file integrity
                if (!target.validator(downloadedContent)) {
                    errorEncountered = "Integrity check failed for ${target.remoteFileName}"
                    continue
                }

                // Compare with current active content
                val currentContent = getFileContent(target.otaFileName, target.fallbackAssetName)
                val currentHash = computeSha256(currentContent.trim())
                val newHash = computeSha256(downloadedContent.trim())

                if (currentHash != newHash) {
                    val localFile = File(context.filesDir, target.otaFileName)
                    localFile.writeText(downloadedContent, Charsets.UTF_8)
                    updatedFiles.add(target.otaFileName)
                }
            } catch (e: Exception) {
                errorEncountered = e.localizedMessage ?: e.message
            }
        }

        withContext(Dispatchers.Main) {
            onComplete(updatedFiles, updatedFiles.isNotEmpty(), errorEncountered)
        }
    }

    private fun fetchWithFallback(fileName: String): String? {
        val timestamp = System.currentTimeMillis()
        val primaryUrl = "$BASE_PRIMARY_URL/$fileName?t=$timestamp"
        val fallbackUrl = "$BASE_FALLBACK_URL/$fileName?t=$timestamp"

        var content = executeRequest(primaryUrl)
        if (content == null) {
            content = executeRequest(fallbackUrl)
        }
        return content
    }

    private fun executeRequest(url: String): String? {
        return try {
            val request = Request.Builder()
                .url(url)
                .header("Cache-Control", "no-cache, no-store, must-revalidate")
                .header("Pragma", "no-cache")
                .header("Accept", "*/*")
                .build()

            httpClient.newCall(request).execute().use { response ->
                if (response.isSuccessful) {
                    response.body?.string()
                } else {
                    null
                }
            }
        } catch (e: Exception) {
            null
        }
    }

    private fun computeSha256(text: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val bytes = digest.digest(text.toByteArray(Charsets.UTF_8))
        return bytes.joinToString("") { "%02x".format(it) }
    }

    private data class SyncTarget(
        val otaFileName: String,
        val fallbackAssetName: String,
        val remoteFileName: String,
        val validator: (String) -> Boolean
    )
}
