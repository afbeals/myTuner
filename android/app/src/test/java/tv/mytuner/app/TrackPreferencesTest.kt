package tv.mytuner.app

import org.junit.Assert.*
import org.junit.Test
import java.util.Locale

class TrackPreferencesTest {
    @Test
    fun languagesMatchNewIndicesAndMissingLanguagesUseDefault() {
        assertEquals(
            5,
            TrackPreferences.match(
                "en-US",
                listOf(TrackPreferences.Track(1, "spa"), TrackPreferences.Track(5, "eng")),
            ),
        )
        assertEquals(12, TrackPreferences.match("eng", listOf(TrackPreferences.Track(12, "en"))))
        assertEquals(-1, TrackPreferences.match("en", listOf(TrackPreferences.Track(1, "es"))))
        assertEquals(-1, TrackPreferences.match("und", listOf(TrackPreferences.Track(1, "und"))))
        assertEquals(-1, TrackPreferences.match(null, emptyList()))
    }
    @Test
    fun allPlatformIsoLanguagesAndBibliographicAliasesMatchAcrossNewIndices() {
        for (code in Locale.getISOLanguages()) {
            val locale = Locale.forLanguageTag(code)
            val canonical = locale.language.lowercase(Locale.ROOT)
            val iso3 = locale.isO3Language.lowercase(Locale.ROOT)
            assertEquals(code, canonical, TrackPreferences.language(iso3))
            assertEquals(iso3, 17, TrackPreferences.match(iso3, listOf(TrackPreferences.Track(17, canonical))))
            assertEquals(code, 23, TrackPreferences.match(canonical, listOf(TrackPreferences.Track(23, iso3))))
        }
        for ((alias, canonical) in mapOf(
            "alb" to "sq", "arm" to "hy", "baq" to "eu", "bur" to "my",
            "chi" to "zh", "cze" to "cs", "dut" to "nl", "fre" to "fr",
            "geo" to "ka", "ger" to "de", "gre" to "el", "ice" to "is",
            "mac" to "mk", "mao" to "mi", "may" to "ms", "per" to "fa",
            "rum" to "ro", "slo" to "sk", "tib" to "bo", "wel" to "cy",
            "iw" to "he", "ji" to "yi", "in" to "id",
        )) assertEquals(alias, canonical, TrackPreferences.language(alias))
    }

    @Test
    fun normalizationIsLocaleIndependentAndKeepsUnknownIdentityAndMissingFallback() {
        val original = Locale.getDefault()
        try {
            Locale.setDefault(Locale.forLanguageTag("tr-TR"))
            assertEquals("it", TrackPreferences.language(" ITA_it "))
            assertEquals("ja", TrackPreferences.language("JPN"))
            assertEquals("zh", TrackPreferences.language("zho-Hant"))
            assertEquals("xyz", TrackPreferences.language("XYZ"))
            assertNull(TrackPreferences.language("und"))
            assertNull(TrackPreferences.language(" "))
            assertNull(TrackPreferences.language(null))
            assertEquals(-1, TrackPreferences.match("ja", listOf(TrackPreferences.Track(2, "it"))))
            assertEquals(-1, TrackPreferences.match("und", listOf(TrackPreferences.Track(2, null))))
        } finally {
            Locale.setDefault(original)
        }
    }

}
