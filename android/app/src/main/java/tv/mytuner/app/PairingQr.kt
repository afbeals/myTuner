package tv.mytuner.app

import android.graphics.Bitmap
import android.graphics.Color
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter

object PairingQr {
    fun payload(base: String, publicCode: String): String {
        require(Regex("[a-fA-F0-9]{10}").matches(publicCode))
        val origin = PlaybackMath.serverAddress(base)
        return "$origin/#connect-tv?code=${publicCode.uppercase()}"
    }

    fun bitmap(base: String, publicCode: String): Bitmap {
        val matrix = QRCodeWriter().encode(payload(base, publicCode), BarcodeFormat.QR_CODE, 360, 360)
        val pixels = IntArray(360 * 360) { index -> if (matrix[index % 360, index / 360]) Color.BLACK else Color.WHITE }
        return Bitmap.createBitmap(pixels, 360, 360, Bitmap.Config.ARGB_8888)
    }
}
