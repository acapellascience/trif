plugins {
    id("com.android.application")
}

android {
    namespace = "com.timsrobot.trif"
    compileSdk = 37
    defaultConfig {
        applicationId = "com.timsrobot.trif"
        minSdk = 29
        targetSdk = 37
        versionCode = 1
        versionName = "0.1"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    testOptions { unitTests.isReturnDefaultValues = true }
}

// The web code shared with the iPhone app comes straight from the repo at build time (never copied into git):
// SES, mobile/shared/gen (made by mobile/prepare.js), mobile/shared's kit.js + modfile.js, the iPhone app's Web/
// folder, and Android's own adapter scripts (src/main/js). Assets: ses.umd.min.js, gen/, shared/, web/, js/.
abstract class SharedAssets : DefaultTask() {
    @get:InputFile abstract val ses: RegularFileProperty
    @get:InputDirectory abstract val gen: DirectoryProperty
    @get:InputFiles abstract val shared: ConfigurableFileCollection
    @get:InputDirectory abstract val web: DirectoryProperty
    @get:InputDirectory abstract val own: DirectoryProperty
    @get:OutputDirectory abstract val out: DirectoryProperty
    @get:Inject abstract val fs: FileSystemOperations

    @TaskAction fun copy() {
        fs.sync {
            into(out)
            from(ses)
            from(gen) { into("gen") }
            from(shared) { into("shared") }
            from(web) { into("web") }
            from(own) { into("js") }
        }
    }
}
val repo = rootDir.resolve("../..")
val sharedAssets = tasks.register<SharedAssets>("sharedAssets") {
    ses.set(repo.resolve("extension/vendor/ses.umd.min.js"))
    gen.set(repo.resolve("mobile/shared/gen"))
    shared.from(repo.resolve("mobile/shared/kit.js"), repo.resolve("mobile/shared/modfile.js"))
    web.set(repo.resolve("mobile/browser-probe/TrifProbe/Web"))
    own.set(projectDir.resolve("src/main/js"))
    out.set(layout.buildDirectory.dir("generated/trif-assets"))
}
androidComponents {
    onVariants { v -> v.sources.assets?.addGeneratedSourceDirectory(sharedAssets, SharedAssets::out) }
}

dependencies {
    implementation("androidx.webkit:webkit:1.18.0")
    testImplementation("junit:junit:4.13.2")
}
