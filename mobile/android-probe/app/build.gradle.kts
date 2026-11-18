plugins {
    id("com.android.application")
}

android {
    namespace = "com.timsrobot.trif.probe"
    compileSdk = 37
    defaultConfig {
        applicationId = "com.timsrobot.trif.probe"
        minSdk = 29
        targetSdk = 37
        versionCode = 1
        versionName = "0.1"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

// SES and TRIF's sandbox runtime come straight from the repo, copied in at build time (not committed)
val copyProbeAssets by tasks.registering(Copy::class) {
    from(rootDir.resolve("../../extension/vendor/ses.umd.min.js"))
    from(rootDir.resolve("../shared/gen/sandbox-runtime.js"))
    from(rootDir.resolve("js"))
    into(projectDir.resolve("src/main/assets"))
}
tasks.named("preBuild") { dependsOn(copyProbeAssets) }

dependencies {
    implementation("androidx.webkit:webkit:1.18.0")
}
