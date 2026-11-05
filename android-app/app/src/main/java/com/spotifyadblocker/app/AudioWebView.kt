package com.spotifyadblocker.app

import android.content.Context
import android.util.AttributeSet
import android.view.View
import android.webkit.WebView

/**
 * Custom WebView that ensures web media playback remains uninterrupted during
 * background and screen-off states without interfering with Chromium's native touch
 * and IME (soft keyboard) dispatch.
 */
class AudioWebView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : WebView(context, attrs, defStyleAttr) {

    init {
        isFocusable = true
        isFocusableInTouchMode = true
    }

    override fun onWindowVisibilityChanged(visibility: Int) {
        // Enforce View.VISIBLE on window visibility changes to maintain
        // active JavaScript media timers while the Foreground Service is active.
        super.onWindowVisibilityChanged(View.VISIBLE)
    }
}
