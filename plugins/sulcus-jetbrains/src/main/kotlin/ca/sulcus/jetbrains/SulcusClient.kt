package ca.sulcus.jetbrains

import com.intellij.openapi.project.Project
import java.io.File
import java.net.InetAddress
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.attribute.PosixFilePermissions
import java.security.MessageDigest
import java.time.Duration
import java.util.concurrent.CompletableFuture

object SulcusClient {
    private val httpClient: HttpClient = HttpClient.newBuilder()
        .connectTimeout(Duration.ofMillis(1500))
        .build()

    @Volatile
    private var cachedMachineId: String? = null

    fun resolveMachineId(): String {
        cachedMachineId?.let { return it }
        val envOverride = System.getenv("SULCUS_MACHINE_ID")?.trim()
        if (!envOverride.isNullOrEmpty()) {
            cachedMachineId = envOverride
            return envOverride
        }
        val customPath = System.getenv("SULCUS_MACHINE_ID_PATH")?.trim()
        val idFile = if (!customPath.isNullOrEmpty()) {
            File(customPath)
        } else {
            File(System.getProperty("user.home", "."), ".config/sulcus/machine_id")
        }
        try {
            if (idFile.isFile) {
                val existing = idFile.readText(StandardCharsets.UTF_8).trim()
                if (existing.length in 8..128 && existing.all { it.isLetterOrDigit() || it == '-' || it == '_' }) {
                    cachedMachineId = existing
                    return existing
                }
            }
        } catch (_: Exception) {
        }

        val rawHost = try {
            InetAddress.getLocalHost().hostName
        } catch (_: Exception) {
            System.getenv("HOSTNAME") ?: System.getenv("COMPUTERNAME") ?: "workstation"
        }
        val shortHost = rawHost.trim().substringBefore('.').trim().lowercase().ifEmpty { "workstation" }
        val cleanUser = (System.getProperty("user.name") ?: System.getenv("USER") ?: "user")
            .trim()
            .lowercase()
            .ifEmpty { "user" }
        val osProp = (System.getProperty("os.name") ?: "").lowercase()
        val canonicalOs = when {
            osProp.contains("mac") || osProp.contains("darwin") -> "macos"
            osProp.contains("win") -> "windows"
            osProp.contains("linux") -> "linux"
            osProp.isBlank() -> "unknown"
            else -> osProp
        }
        val digest = MessageDigest.getInstance("SHA-256")
            .digest("$shortHost:$cleanUser:$canonicalOs".toByteArray(StandardCharsets.UTF_8))
        val computed = digest.joinToString("") { "%02x".format(it) }.take(32)

        try {
            idFile.parentFile?.let { dir ->
                if (!dir.exists()) {
                    dir.mkdirs()
                    try {
                        Files.setPosixFilePermissions(dir.toPath(), PosixFilePermissions.fromString("rwx------"))
                    } catch (_: Exception) {
                    }
                }
            }
            idFile.writeText("$computed\n", StandardCharsets.UTF_8)
            try {
                Files.setPosixFilePermissions(idFile.toPath(), PosixFilePermissions.fromString("rw-------"))
            } catch (_: Exception) {
            }
        } catch (_: Exception) {
        }

        cachedMachineId = computed
        return computed
    }

    private val ansiRegex = Regex("\u001B\\[[0-9;]*[a-zA-Z]|\u001B\\][^\u0007]*\u0007")
    private val rspecLocRegex = Regex("^rspec\\s+(\\.?/?spec/[^\\s]+:\\d+)")

    fun resolveNamespace(project: Project): String {
        val settings = SulcusSettingsState.getInstance()
        if (settings.defaultNamespace.isNotBlank()) {
            return sanitizeSlug(settings.defaultNamespace)
        }
        val envNs = System.getenv("SULCUS_NAMESPACE")
        if (!envNs.isNullOrBlank() && envNs != "default") {
            return sanitizeSlug(envNs)
        }
        val basePath = project.basePath ?: return sanitizeSlug(project.name)
        val root = File(basePath)
        val markers = listOf(
            ".junie", "Gemfile", "Rakefile", ".ruby-version", "config/application.rb",
            "Cargo.toml", "package.json", "pyproject.toml", "go.mod", ".git"
        )
        val hasRubyOrRepoMarker = markers.any { File(root, it).exists() } ||
            (root.listFiles()?.any { it.name.endsWith(".gemspec") } == true)
        return if (hasRubyOrRepoMarker) sanitizeSlug(root.name) else sanitizeSlug(project.name)
    }

    fun isRubyOrRailsProject(project: Project): Boolean {
        val basePath = project.basePath ?: return false
        val root = File(basePath)
        return File(root, "Gemfile").exists() ||
            File(root, "Rakefile").exists() ||
            File(root, ".ruby-version").exists() ||
            File(root, "config/application.rb").exists()
    }

    /**
     * Compact verbose RSpec, Minitest, Rake, and RuboCop terminal output into a clean
     * System 1 ingestion summary without ANSI codes or `/gems/` vendor frames.
     */
    fun compactRubyRunOutput(runConfigName: String, rawLog: String, exitCode: Int): String? {
        val cleaned = ansiRegex.replace(rawLog, "").replace("\r\n", "\n")
        if (cleaned.isBlank()) return null

        val lines = cleaned.lineSequence()
            .map { it.trimEnd() }
            .filter { it.isNotBlank() && !it.contains("/gems/") && !it.contains("/rubies/") }
            .toList()

        val summaryLine = lines.firstOrNull {
            it.contains("examples,") && it.contains("failure") ||
                it.contains("runs,") && it.contains("assertions,") ||
                it.contains("files inspected,") && it.contains("offense")
        }

        val failingSpecs = mutableListOf<String>()
        val failureDetails = mutableListOf<String>()
        var pendingMigrations = false

        for (line in lines) {
            val trimmed = line.trim()
            if (trimmed.contains("PendingMigrationError") || trimmed.contains("Migrations are pending")) {
                pendingMigrations = true
            }
            val m = rspecLocRegex.find(trimmed)
            if (m != null) {
                failingSpecs.add(m.groupValues[1])
            } else if (
                trimmed.startsWith("Failure/Error:") ||
                trimmed.startsWith("NoMethodError:") ||
                trimmed.startsWith("ActiveRecord::")
            ) {
                if (failureDetails.size < 5) failureDetails.add(trimmed.take(180))
            }
        }

        if (exitCode == 0 && !pendingMigrations && failingSpecs.isEmpty()) {
            return null
        }

        return buildString {
            append("Run failure in `$runConfigName`")
            if (summaryLine != null) append(" ($summaryLine)")
            append(".")
            if (pendingMigrations) append(" Pending database migrations (`bin/rails db:migrate`).")
            if (failingSpecs.isNotEmpty()) append(" Failing specs: ${failingSpecs.take(6).joinToString(", ")}.")
            if (failureDetails.isNotEmpty()) append(" Details: ${failureDetails.joinToString(" | ")}")
        }.take(1200)
    }

    fun postDualAsync(path: String, jsonBody: String): CompletableFuture<String?> {
        val settings = SulcusSettingsState.getInstance()
        val apiKey = settings.loadApiKey()
        val localFuture = if (settings.localUrl.isNotBlank()) {
            postJsonAsync("${settings.localUrl.trimEnd('/')}$path", jsonBody, "")
        } else {
            CompletableFuture.completedFuture(null)
        }
        val effectiveServer = settings.resolveServerUrl()
        val remoteFuture = if (settings.hybridMode && apiKey.isNotBlank() && effectiveServer.isNotBlank()) {
            postJsonAsync("${effectiveServer.trimEnd('/')}$path", jsonBody, apiKey)
        } else {
            CompletableFuture.completedFuture(null)
        }
        return localFuture.thenCombine(remoteFuture) { localRes, remoteRes ->
            remoteRes ?: localRes
        }
    }

    fun postJsonAsync(url: String, jsonBody: String, bearerToken: String): CompletableFuture<String?> {
        return try {
            val builder = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .timeout(Duration.ofMillis(2200))
                .header("Content-Type", "application/json")
                .header("X-Sulcus-Machine-Id", resolveMachineId())
                .POST(HttpRequest.BodyPublishers.ofString(jsonBody))
            if (bearerToken.isNotBlank()) {
                builder.header("Authorization", "Bearer $bearerToken")
            }
            httpClient.sendAsync(builder.build(), HttpResponse.BodyHandlers.ofString())
                .thenApply { resp -> if (resp.statusCode() in 200..299) resp.body() else null }
                .exceptionally { null }
        } catch (_: Exception) {
            CompletableFuture.completedFuture(null)
        }
    }

    fun escapeJson(raw: String): String = buildString(raw.length + 16) {
        for (ch in raw) {
            when (ch) {
                '\\' -> append("\\\\")
                '"' -> append("\\\"")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> if (ch.code < 0x20) append(' ') else append(ch)
            }
        }
    }

    private fun sanitizeSlug(raw: String): String =
        raw.trim().lowercase().replace(Regex("[^a-z0-9_-]+"), "-").trim('-').ifEmpty { "default" }
}
