plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
android {
    namespace = "tv.mytuner.app"
    compileSdk = 35
    defaultConfig { applicationId = "tv.mytuner.app"; minSdk = 23; targetSdk = 35; versionCode = 2; versionName = "0.2.0" }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    buildTypes { getByName("release") { isMinifyEnabled = false } }
    testOptions { unitTests.isReturnDefaultValues = true }
    // Release signing belongs in a private external Gradle init/configuration file.
}
dependencies {
    implementation("com.google.zxing:core:3.5.3")
    implementation("androidx.media3:media3-exoplayer:1.6.1")
    implementation("androidx.media3:media3-exoplayer-hls:1.6.1")
    implementation("androidx.media3:media3-ui:1.6.1")
    testImplementation("junit:junit:4.13.2")
}
