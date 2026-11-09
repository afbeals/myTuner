package tv.mytuner.app

import java.util.Locale

object TrackPreferences {
    data class Track(val index: Int, val language: String?)

    // ISO 639-2 terminology codes come from the platform, with bibliographic aliases.
    private val aliases: Map<String, String> by lazy {
        Locale.getISOLanguages().associateBy(
            { Locale.forLanguageTag(it).isO3Language.lowercase(Locale.ROOT) },
            { Locale.forLanguageTag(it).language.lowercase(Locale.ROOT) },
        ) + mapOf(
            "iw" to "he", "ji" to "yi", "in" to "id",
            "alb" to "sq", "arm" to "hy", "baq" to "eu", "bur" to "my",
            "chi" to "zh", "cze" to "cs", "dut" to "nl", "fre" to "fr",
            "geo" to "ka", "ger" to "de", "gre" to "el", "ice" to "is",
            "mac" to "mk", "mao" to "mi", "may" to "ms", "per" to "fa",
            "rum" to "ro", "slo" to "sk", "tib" to "bo", "wel" to "cy",
        )
    }

    fun language(value: String?): String? {
        val tag = value?.trim()?.lowercase(Locale.ROOT)?.replace('_', '-') ?: return null
        if (tag.isBlank() || tag == "und") return null
        val first = tag.substringBefore('-')
        return aliases[first] ?: first
    }

    fun match(preferred: String?, tracks: List<Track>): Int =
        language(preferred)?.let { wanted ->
            tracks.firstOrNull { language(it.language) == wanted }?.index
        } ?: -1
}
