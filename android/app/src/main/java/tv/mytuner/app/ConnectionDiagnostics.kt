package tv.mytuner.app

enum class PairingReason { FIRST_TIME, AUTHORIZATION_EXPIRED }

object ConnectionDiagnostics {
    fun pairingReason(status: Int?): PairingReason? =
        if (status == 401) PairingReason.AUTHORIZATION_EXPIRED else null

    fun pairingDescription(reason: PairingReason): String = when (reason) {
        PairingReason.FIRST_TIME -> "Your account password stays off the television."
        PairingReason.AUTHORIZATION_EXPIRED ->
            "This TV’s approval expired or was removed. Approve this new code to reconnect."
    }

    fun compatible(apiVersion: Int) = apiVersion == 1

    fun category(status: Int?): String =
        when (status) {
            401 -> "authorization-expired"
            403 -> "access-denied"
            404,
            409 -> "content-unavailable"
            422 -> "unsupported-media"
            429 -> "server-busy"
            500,
            502,
            503,
            504 -> "server-unavailable"
            else -> "connection-failed"
        }
}
