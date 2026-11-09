package tv.mytuner.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class PairingQrTest {
    @Test fun publicApprovalPayloadContainsOnlyOriginAndPublicCode() {
        val value = PairingQr.payload("http://192.168.1.5:8777", "abcdef1234")
        assertEquals("http://192.168.1.5:8777/#connect-tv?code=ABCDEF1234", value)
        assertFalse(value.contains("deviceCode"))
        assertFalse(value.contains("token"))
    }
    @Test(expected = IllegalArgumentException::class) fun rejectsDeviceSecretAsPublicCode() {
        PairingQr.payload("http://localhost:8777", "private-device-code")
    }
}
