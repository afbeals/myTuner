package tv.mytuner.app

import org.junit.Assert.*
import org.junit.Test

class PairingRetryTest {
    @Test fun retriesOnlyTransientFailuresBeforeExpiry() {
        listOf(null, 408, 429, 500, 503).forEach { status ->
            assertTrue(PairingRetry.shouldRetry(status, 100, 200))
            assertFalse(PairingRetry.shouldRetry(status, 200, 200))
        }
        listOf(400, 401, 403, 404, 410).forEach { status ->
            assertFalse(PairingRetry.shouldRetry(status, 100, 200))
        }
    }
}
