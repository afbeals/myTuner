package tv.mytuner.app

import java.net.URI

object PlaybackMath {
    fun serverAddress(raw: String): String {
        val uri = URI(raw.trim())
        require(
            uri.scheme in listOf("http", "https") &&
                !uri.host.isNullOrBlank() &&
                uri.rawUserInfo == null &&
                uri.rawQuery == null &&
                uri.rawFragment == null &&
                uri.path in listOf("", "/") &&
                (uri.port == -1 || uri.port in 1..65535)
        ) {
            "Use http:// or https://, a hostname or LAN IP, and an optional port. Do not include a path or password."
        }
        return "${uri.scheme}://${uri.rawAuthority}"
    }

    fun mediaAddress(base: String, raw: String): String {
        val origin = URI(serverAddress(base))
        val uri = origin.resolve(raw)
        require(
            uri.scheme == origin.scheme &&
                uri.host == origin.host &&
                uri.port == origin.port &&
                uri.rawUserInfo == null &&
                uri.rawFragment == null &&
                uri.path.startsWith("/api/") &&
                !uri.path.contains("\\")
        ) {
            "The server returned an invalid media address."
        }
        return uri.toASCIIString()
    }

    fun channelPosition(entryStart: Long, offset: Long, sourcePosition: Long): Long =
        entryStart + sourcePosition - offset

    fun sourcePosition(entryStart: Long, offset: Long, channelPosition: Long): Long =
        offset + channelPosition - entryStart

    data class Cue(val start: Long, val end: Long, val text: String)

    fun captions(raw: String): List<Cue> =
        raw.replace("\r", "").split(Regex("\n\n+")).mapNotNull { block ->
            val lines = block.lines()
            val index = lines.indexOfFirst { it.contains(" --> ") }
            if (index < 0 || block.startsWith("NOTE")) return@mapNotNull null
            val match =
                Regex("^([\\d:.]+) --> ([\\d:.]+)").find(lines[index]) ?: return@mapNotNull null
            fun timestamp(s: String) =
                (s.split(":").fold(0.0) { n, v -> n * 60 + v.toDouble() } * 1000).toLong()
            runCatching {
                    Cue(
                        timestamp(match.groupValues[1]),
                        timestamp(match.groupValues[2]),
                        lines.drop(index + 1).joinToString("\n").replace(Regex("<[^>]*>"), ""),
                    )
                }
                .getOrNull()
                ?.takeIf { it.end > it.start }
        }
}
