package com.spotifyadblocker.app

import android.content.Context
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.View
import android.webkit.WebView

/**
 * Custom WebView that ensures soft-keyboard input focus is properly accepted
 * across all Android OEM implementations (including Xiaomi / MIUI / HyperOS) and keeps
 * web media playback uninterrupted during background and screen-off states.
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

    override fun onCheckIsTextEditor(): Boolean {
        return true
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.action) {
            MotionEvent.ACTION_DOWN -> {
                if (!hasFocus()) {
                    requestFocus()
                }
            }
        }
        return super.onTouchEvent(event)
    }

    override fun onWindowVisibilityChanged(visibility: Int) {
        // Enforce View.VISIBLE on window visibility changes to maintain
        // active JavaScript media timers while the Foreground Service is active.
        super.onWindowVisibilityChanged(View.VISIBLE)
    }
}
