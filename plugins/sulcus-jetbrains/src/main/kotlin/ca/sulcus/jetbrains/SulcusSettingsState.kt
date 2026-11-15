package ca.sulcus.jetbrains

import com.intellij.credentialStore.CredentialAttributes
import com.intellij.credentialStore.Credentials
import com.intellij.credentialStore.generateServiceName
import com.intellij.ide.passwordSafe.PasswordSafe
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.util.xmlb.XmlSerializerUtil
import java.io.File
import java.nio.charset.StandardCharsets

@State(
    name = "ca.sulcus.jetbrains.SulcusSettingsState",
    storages = [Storage("SulcusMemorySettings.xml")]
)
class SulcusSettingsState : PersistentStateComponent<SulcusSettingsState> {
    var localUrl: String = "http://127.0.0.1:4203"
    var serverUrl: String = ""
    var defaultNamespace: String = ""
    var hybridMode: Boolean = true
    var autoCaptureTestFailures: Boolean = true

    override fun getState(): SulcusSettingsState = this

    override fun loadState(state: SulcusSettingsState) {
        XmlSerializerUtil.copyBean(state, this)
    }

    /**
     * Resolve effective remote Sulcus server URL:
     * 1. Explicit IDE setting (if non-blank)
     * 2. `SULCUS_SERVER_URL` environment variable
     * 3. `~/.config/sulcus/sulcus.ini` written by `sulcus login`
     * 4. Default SaaS endpoint (`https://api.sulcus.ca`)
     */
    fun resolveServerUrl(): String {
        if (serverUrl.isNotBlank()) return serverUrl.trim()
        val envUrl = System.getenv("SULCUS_SERVER_URL")
        if (!envUrl.isNullOrBlank()) return envUrl.trim()
        val iniUrl = readWorkstationIniField("server_url")
        if (!iniUrl.isNullOrBlank()) return iniUrl
        return "https://api.sulcus.ca"
    }

    /**
     * Store and retrieve `SULCUS_API_KEY` via JetBrains PasswordSafe (OS keychain),
     * falling back to `SULCUS_API_KEY` env var or `~/.config/sulcus/sulcus.ini` (`0600`)
     * written by `sulcus login`. Never persists secret tokens in plain XML config files.
     */
    fun loadApiKey(): String {
        val envKey = System.getenv("SULCUS_API_KEY")
        if (!envKey.isNullOrBlank()) return envKey.trim()
        val attrs = credentialAttributes()
        val keychainVal = PasswordSafe.instance.getPassword(attrs)?.trim().orEmpty()
        if (keychainVal.isNotBlank()) return keychainVal
        return (readWorkstationIniField("server_api_key") ?: readWorkstationIniField("api_key")).orEmpty()
    }

    private fun readWorkstationIniField(targetKey: String): String? {
        val customCfg = System.getenv("SULCUS_CONFIG")?.trim()
        val iniFile = if (!customCfg.isNullOrEmpty()) {
            File(customCfg)
        } else {
            File(System.getProperty("user.home", "."), ".config/sulcus/sulcus.ini")
        }
        if (!iniFile.isFile) return null
        return try {
            iniFile.readLines(StandardCharsets.UTF_8)
                .map { it.trim() }
                .filter { it.isNotEmpty() && !it.startsWith("#") && !it.startsWith(";") && !it.startsWith("[") }
                .firstNotNullOfOrNull { line ->
                    val idx = line.indexOf('=')
                    if (idx <= 0) null
                    else {
                        val k = line.substring(0, idx).trim()
                        val v = line.substring(idx + 1).trim().trim('"', '\'')
                        if (k.equals(targetKey, ignoreCase = true) && v.isNotEmpty()) v else null
                    }
                }
        } catch (_: Exception) {
            null
        }
    }

    fun saveApiKey(rawKey: String) {
        val attrs = credentialAttributes()
        val trimmed = rawKey.trim()
        if (trimmed.isEmpty()) {
            PasswordSafe.instance.set(attrs, null)
        } else {
            PasswordSafe.instance.set(attrs, Credentials("sulcus", trimmed))
        }
    }

    companion object {
        fun getInstance(): SulcusSettingsState =
            ApplicationManager.getApplication().getService(SulcusSettingsState::class.java)

        private fun credentialAttributes(): CredentialAttributes =
            CredentialAttributes(generateServiceName("SulcusMemory", "ApiKey"))
    }
}
