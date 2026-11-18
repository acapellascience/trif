package com.timsrobot.trif

import com.timsrobot.trif.WebViewCheck.Result
import org.junit.Assert.assertEquals
import org.junit.Test

class WebViewCheckTest {
    @Test fun major() {
        assertEquals(149, WebViewCheck.major("149.0.7827.5"))
        assertEquals(145, WebViewCheck.major(" 145 "))
        assertEquals(null, WebViewCheck.major("beta"))
        assertEquals(null, WebViewCheck.major(""))
        assertEquals(null, WebViewCheck.major(null))
    }

    @Test fun decide() {
        assertEquals(Result.Missing, WebViewCheck.decide(null, null, false))
        assertEquals(Result.Ok, WebViewCheck.decide("com.google.android.webview", "149.0.7827.5", true))
        assertEquals(Result.TooOld(145, "com.google.android.webview"),
            WebViewCheck.decide("com.google.android.webview", "145.0.1.2", false))
        // the feature decides, not the number: a 150 without worlds is still too old
        assertEquals(Result.TooOld(150, "org.example.webview"), WebViewCheck.decide("org.example.webview", "150.1", false))
        assertEquals(Result.TooOld(null, "x"), WebViewCheck.decide("x", null, false))
    }
}
