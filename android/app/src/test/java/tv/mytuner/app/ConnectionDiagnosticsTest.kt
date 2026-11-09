package tv.mytuner.app

import org.junit.Assert.*
import org.junit.Test

class ConnectionDiagnosticsTest {
    @Test
    fun rejectsFutureContractsAndClassifiesFailuresWithoutSecrets() {
        assertTrue(ConnectionDiagnostics.compatible(1))
        assertFalse(ConnectionDiagnostics.compatible(2))
        assertEquals("authorization-expired", ConnectionDiagnostics.category(401))
        assertEquals("content-unavailable", ConnectionDiagnostics.category(409))
        assertEquals("unsupported-media", ConnectionDiagnostics.category(422))
        assertEquals("connection-failed", ConnectionDiagnostics.category(null))
    }
}
