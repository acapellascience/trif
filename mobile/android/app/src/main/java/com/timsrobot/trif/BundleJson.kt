package com.timsrobot.trif

import android.os.Bundle
import org.json.JSONObject
import java.util.Base64

/**
 * A Bundle of plain values (what WebView.saveState writes: a byte array) as JSON and back, for storing on disk.
 * Each value is {"t": type, "v": value}; byte arrays are base64. Types it doesn't know are left out.
 */
object BundleJson {
    fun write(b: Bundle): JSONObject = JSONObject().apply {
        for (key in b.keySet()) {
            @Suppress("DEPRECATION") val v = b.get(key)
            val e = when (v) {
                is ByteArray -> pair("bytes", Base64.getEncoder().encodeToString(v))
                is String -> pair("string", v)
                is Int -> pair("int", v)
                is Long -> pair("long", v)
                is Boolean -> pair("bool", v)
                is Bundle -> pair("bundle", write(v))
                else -> null
            }
            if (e != null) put(key, e)
        }
    }

    fun read(o: JSONObject): Bundle = Bundle().apply {
        for (key in o.keys()) {
            val e = o.optJSONObject(key) ?: continue
            when (e.optString("t")) {
                "bytes" -> putByteArray(key, Base64.getDecoder().decode(e.getString("v")))
                "string" -> putString(key, e.getString("v"))
                "int" -> putInt(key, e.getInt("v"))
                "long" -> putLong(key, e.getLong("v"))
                "bool" -> putBoolean(key, e.getBoolean("v"))
                "bundle" -> putBundle(key, read(e.getJSONObject("v")))
            }
        }
    }

    private fun pair(t: String, v: Any) = JSONObject().put("t", t).put("v", v)
}
