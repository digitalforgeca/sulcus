package ca.sulcus.jetbrains

import com.intellij.openapi.options.Configurable
import com.intellij.ui.components.JBCheckBox
import com.intellij.ui.components.JBPasswordField
import com.intellij.ui.components.JBTextField
import com.intellij.util.ui.FormBuilder
import javax.swing.JComponent
import javax.swing.JPanel

class SulcusSettingsConfigurable : Configurable {
    private var panel: JPanel? = null
    private val localUrlField = JBTextField()
    private val serverUrlField = JBTextField()
    private val apiKeyField = JBPasswordField()
    private val namespaceField = JBTextField()
    private val hybridCheckbox = JBCheckBox("Dual-write to Sulcus Cloud API when API key is set")
    private val captureTestsCheckbox = JBCheckBox("Auto-compact and capture failing RSpec / Minitest / Rake runs")

    override fun getDisplayName(): String = "Sulcus Memory"

    override fun createComponent(): JComponent {
        val built = FormBuilder.createFormBuilder()
            .addLabeledComponent("Local Sidecar URL:", localUrlField, 1, false)
            .addLabeledComponent("Remote Sulcus API URL:", serverUrlField, 1, false)
            .addLabeledComponent("API Key (stored in OS Keychain):", apiKeyField, 1, false)
            .addLabeledComponent("Namespace Override (blank = auto):", namespaceField, 1, false)
            .addComponent(hybridCheckbox, 1)
            .addComponent(captureTestsCheckbox, 1)
            .addComponentFillVertically(JPanel(), 0)
            .panel
        panel = built
        reset()
        return built
    }

    override fun isModified(): Boolean {
        val s = SulcusSettingsState.getInstance()
        return localUrlField.text.trim() != s.localUrl ||
            serverUrlField.text.trim() != s.resolveServerUrl() ||
            String(apiKeyField.password).trim() != s.loadApiKey() ||
            namespaceField.text.trim() != s.defaultNamespace ||
            hybridCheckbox.isSelected != s.hybridMode ||
            captureTestsCheckbox.isSelected != s.autoCaptureTestFailures
    }

    override fun apply() {
        val s = SulcusSettingsState.getInstance()
        s.localUrl = localUrlField.text.trim().ifEmpty { "http://127.0.0.1:4203" }
        s.serverUrl = serverUrlField.text.trim()
        s.saveApiKey(String(apiKeyField.password))
        s.defaultNamespace = namespaceField.text.trim()
        s.hybridMode = hybridCheckbox.isSelected
        s.autoCaptureTestFailures = captureTestsCheckbox.isSelected
    }

    override fun reset() {
        val s = SulcusSettingsState.getInstance()
        localUrlField.text = s.localUrl
        serverUrlField.text = s.resolveServerUrl()
        apiKeyField.text = s.loadApiKey()
        namespaceField.text = s.defaultNamespace
        hybridCheckbox.isSelected = s.hybridMode
        captureTestsCheckbox.isSelected = s.autoCaptureTestFailures
    }
}
