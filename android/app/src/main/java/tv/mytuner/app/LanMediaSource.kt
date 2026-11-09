package tv.mytuner.app

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.datasource.BaseDataSource
import androidx.media3.datasource.DataSpec
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection

// Every playlist/segment/file request stays on the paired server. Redirects are rejected.
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class LanMediaSource(private val api: LanApi) : BaseDataSource(true) {
    private var connection: HttpURLConnection? = null
    private var input: InputStream? = null
    private var uri: Uri? = null
    private var started = false
    private var remaining = C.LENGTH_UNSET.toLong()

    override fun open(dataSpec: DataSpec): Long {
        transferInitializing(dataSpec)
        uri = dataSpec.uri
        val c = api.connection(dataSpec.uri.toString())
        connection = c
        dataSpec.httpRequestHeaders.forEach { (key, value) ->
            if (!key.equals("Authorization", true)) c.setRequestProperty(key, value)
        }
        if (dataSpec.position > 0 || dataSpec.length != C.LENGTH_UNSET.toLong()) {
            val end =
                if (dataSpec.length == C.LENGTH_UNSET.toLong()) ""
                else (dataSpec.position + dataSpec.length - 1).toString()
            c.setRequestProperty("Range", "bytes=${dataSpec.position}-$end")
        }
        val status = c.responseCode
        if (status !in 200..299) throw IOException("Media request failed ($status).")
        if (dataSpec.position > 0 && status != 206)
            throw IOException("The server did not honor the requested byte range.")
        input = c.inputStream
        remaining =
            if (dataSpec.length != C.LENGTH_UNSET.toLong()) dataSpec.length
            else c.getHeaderField("Content-Length")?.toLongOrNull() ?: C.LENGTH_UNSET.toLong()
        started = true
        transferStarted(dataSpec)
        return remaining
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (length == 0) return 0
        if (remaining == 0L) return C.RESULT_END_OF_INPUT
        val count =
            input?.read(
                buffer,
                offset,
                if (remaining < 0) length else minOf(length.toLong(), remaining).toInt(),
            ) ?: -1
        if (count < 0) return C.RESULT_END_OF_INPUT
        if (remaining > 0) remaining -= count
        bytesTransferred(count)
        return count
    }

    override fun getUri(): Uri? = uri

    override fun getResponseHeaders(): Map<String, List<String>> =
        connection?.headerFields?.filterKeys { it != null }?.mapKeys { it.key!! } ?: emptyMap()

    override fun close() {
        try {
            input?.close()
        } finally {
            input = null
            connection?.disconnect()
            connection = null
            uri = null
            if (started) {
                started = false
                transferEnded()
            }
        }
    }
}
