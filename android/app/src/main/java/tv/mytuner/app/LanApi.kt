package tv.mytuner.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject

class ApiFailure(val status: Int, message: String) : Exception(message)

class TokenVault(context: Context) {
    private val prefs = context.getSharedPreferences("device", Context.MODE_PRIVATE)

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        return (store.getKey("mytuner-device", null) as? SecretKey)
            ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
                .apply {
                    init(
                        KeyGenParameterSpec.Builder(
                                "mytuner-device",
                                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                            )
                            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                            .build()
                    )
                }
                .generateKey()
    }

    fun save(token: String?) {
        if (token == null) {
            prefs.edit().remove("credential").apply()
            return
        }
        val cipher =
            Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        prefs
            .edit()
            .putString(
                "credential",
                Base64.encodeToString(
                    cipher.iv + cipher.doFinal(token.toByteArray(Charsets.UTF_8)),
                    Base64.NO_WRAP,
                ),
            )
            .apply()
    }

    fun read(): String? =
        runCatching {
                val data =
                    Base64.decode(
                        prefs.getString("credential", null) ?: return null,
                        Base64.NO_WRAP,
                    )
                val cipher =
                    Cipher.getInstance("AES/GCM/NoPadding").apply {
                        init(
                            Cipher.DECRYPT_MODE,
                            key(),
                            GCMParameterSpec(128, data.copyOfRange(0, 12)),
                        )
                    }
                String(cipher.doFinal(data.copyOfRange(12, data.size)), Charsets.UTF_8)
            }
            .getOrNull()
}

class LanApi(@Volatile var base: String, @Volatile var token: String? = null) {
    fun connection(raw: String, method: String = "GET"): HttpURLConnection {
        val result = URL(PlaybackMath.mediaAddress(base, raw)).openConnection() as HttpURLConnection
        result.instanceFollowRedirects = false
        result.connectTimeout = 8000
        result.readTimeout = 15000
        result.requestMethod = method
        result.setRequestProperty("Accept", "application/json")
        result.setRequestProperty("Cache-Control", "no-store")
        token?.let { result.setRequestProperty("Authorization", "Bearer $it") }
        return result
    }

    fun request(path: String, method: String = "GET", body: JSONObject? = null): String {
        val c = connection(path, method)
        try {
            if (body != null || method == "POST") {
                c.doOutput = true
                c.setRequestProperty("Content-Type", "application/json")
                c.outputStream.use {
                    it.write((body ?: JSONObject()).toString().toByteArray(Charsets.UTF_8))
                }
            }
            val status = c.responseCode
            val raw =
                (if (status in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use {
                    it.readText()
                } ?: ""
            if (status !in 200..299)
                throw ApiFailure(
                    status,
                    runCatching { JSONObject(raw).optString("error") }
                        .getOrNull()
                        ?.takeIf { it.isNotBlank() } ?: "Server request failed ($status).",
                )
            return raw
        } catch (failure: java.io.IOException) {
            throw java.io.IOException(
                "Unable to reach your server. Check its address and network access, then try again.",
                failure,
            )
        } finally {
            c.disconnect()
        }
    }

    fun json(path: String, method: String = "GET", body: JSONObject? = null): JSONObject =
        try {
            JSONObject(request(path, method, body))
        } catch (failure: org.json.JSONException) {
            throw Exception("The server returned an unreadable response. Try again.", failure)
        }
}
