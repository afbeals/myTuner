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

    @Test
    fun approvalLossHasItsOwnRecoveryReasonAndPhoneAction() {
        val reason = ConnectionDiagnostics.pairingReason(401)
        assertEquals(PairingReason.AUTHORIZATION_EXPIRED, reason)
        assertEquals("authorization-expired", ConnectionDiagnostics.category(401))
        val recovery = ConnectionDiagnostics.pairingDescription(reason!!)
        assertTrue(recovery.contains("approval expired or was removed"))
        assertTrue(recovery.contains("Approve this new code to reconnect"))
        assertFalse(recovery.contains("password stays off"))
        assertEquals("Your account password stays off the television.", ConnectionDiagnostics.pairingDescription(PairingReason.FIRST_TIME))
    }

    @Test
    fun accessDenialAndNetworkOutageDoNotAskForNewApproval() {
        listOf(null, 403, 404, 409, 429, 500, 503).forEach { status ->
            assertNull(ConnectionDiagnostics.pairingReason(status))
        }
    }
}
