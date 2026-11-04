package com.spotifyadblocker.app

import android.content.Context
import android.util.AttributeSet
import android.view.View
import android.webkit.WebView

/**
 * Custom WebView that prevents pausing web media playback when the Activity
 * goes into the background or when the device screen turns off.
 */
class AudioWebView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : WebView(context, attrs, defStyleAttr) {

    override fun onWindowVisibilityChanged(visibility: Int) {
        // Enforce View.VISIBLE on window visibility changes to maintain
        // active JavaScript media timers while the Foreground Service is active.
        super.onWindowVisibilityChanged(View.VISIBLE)
    }
}
