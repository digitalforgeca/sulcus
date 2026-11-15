package ca.sulcus.jetbrains

import com.intellij.ide.trustedProjects.TrustedProjects
import com.intellij.ide.trustedProjects.TrustedProjectsLocator
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.StatusBar
import com.intellij.openapi.wm.StatusBarWidget
import com.intellij.openapi.wm.StatusBarWidgetFactory
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextArea
import com.intellij.ui.content.ContentFactory
import java.awt.BorderLayout
import java.io.File
import javax.swing.JButton
import javax.swing.JPanel

object SulcusNotify {
    fun info(project: Project?, title: String, content: String) {
        NotificationGroupManager.getInstance()
            .getNotificationGroup("Sulcus Notifications")
            .createNotification(title, content, NotificationType.INFORMATION)
            .notify(project)
    }

    fun warn(project: Project?, title: String, content: String) {
        NotificationGroupManager.getInstance()
            .getNotificationGroup("Sulcus Notifications")
            .createNotification(title, content, NotificationType.WARNING)
            .notify(project)
    }
}

/**
 * Writes zero-secret `.junie/mcp/mcp.json` and `.junie/guidelines.md` (plus `.gitignore` guards)
 * for JetBrains Junie inside RubyMine or any IntelliJ-based IDE.
 */
class BootstrapJunieAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        if (!TrustedProjects.isProjectTrusted(TrustedProjectsLocator.locateProject(project))) {
            SulcusNotify.warn(project, "Untrusted Project", "Trust this project first before writing .junie configuration.")
            return
        }
        val basePath = project.basePath ?: return
        val root = File(basePath)
        val junieDir = File(root, ".junie")
        val mcpDir = File(junieDir, "mcp")
        mcpDir.mkdirs()

        val mcpFile = File(mcpDir, "mcp.json")
        if (!mcpFile.exists()) {
            mcpFile.writeText(
                """
                {
                  "mcpServers": {
                    "sulcus": {
                      "command": "sulcus",
                      "args": ["mcp-proxy"]
                    }
                  }
                }
                """.trimIndent() + "\n"
            )
        }

        val guidelinesFile = File(junieDir, "guidelines.md")
        val marker = "<!-- sulcus-junie-guidelines -->"
        val snippet = """
            $marker
            # Sulcus Thermodynamic Memory & RubyMine Guidelines
            - Scan `<sulcus-memories>` first, or call `build_context` / `search_memory` before broad repo searches.
            - Store durable conventions (`preference`), architecture (`semantic`), domain axioms (`fact`), and workflows (`procedural`) via `store_memory`. Never create flat `MEMORY.md` files.
            - In Ruby/Rails workspaces, prefer targeted `bundle exec rspec spec/path_spec.rb:LINE` runs and RubyMine symbol navigation.
            $marker
        """.trimIndent() + "\n"
        if (!guidelinesFile.exists()) {
            guidelinesFile.writeText(snippet)
        } else {
            val cur = guidelinesFile.readText()
            if (!cur.contains(marker)) {
                guidelinesFile.writeText(cur.trimEnd() + "\n\n" + snippet)
            }
        }

        val gitignore = File(root, ".gitignore")
        val existingIgnore = if (gitignore.exists()) gitignore.readText() else ""
        if (!existingIgnore.contains(".junie/mcp/mcp.local.json")) {
            gitignore.appendText("\n# Sulcus local state & private Junie overrides\n.sulcus/\n.junie/mcp/mcp.local.json\n")
        }

        SulcusNotify.info(
            project,
            "Sulcus + Junie Configured",
            "Wrote zero-secret .junie/mcp/mcp.json and guidelines for namespace '${SulcusClient.resolveNamespace(project)}'."
        )
    }
}

class RecallContextAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val editor = e.getData(CommonDataKeys.EDITOR)
        val selected = editor?.selectionModel?.selectedText?.trim().orEmpty()
        val query = selected.ifEmpty { "active project architecture rules and conventions" }
        val ns = SulcusClient.resolveNamespace(project)
        val body = """{"query":"${SulcusClient.escapeJson(query)}","limit":6,"namespace":"${SulcusClient.escapeJson(ns)}"}"""

        SulcusClient.postDualAsync("/api/v1/agent/search", body).thenAccept { resp ->
            val preview = resp?.take(500) ?: "No Sulcus sidecar or server response (check `sulcus serve` or Settings)."
            SulcusNotify.info(project, "Sulcus Recall ($ns)", preview)
        }
    }
}

class IngestSelectionAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val editor = e.getData(CommonDataKeys.EDITOR) ?: return
        val selected = editor.selectionModel.selectedText?.trim().orEmpty()
        if (selected.isEmpty()) {
            SulcusNotify.warn(project, "Sulcus Ingest", "Select text in the editor first to ingest a memory node.")
            return
        }
        val ns = SulcusClient.resolveNamespace(project)
        val harness = if (SulcusClient.isRubyOrRailsProject(project)) "rubymine" else "jetbrains"
        val body = """
            {
              "assistant_output": "${SulcusClient.escapeJson(selected)}",
              "namespace": "${SulcusClient.escapeJson(ns)}",
              "harness": "$harness"
            }
        """.trimIndent()
        SulcusClient.postDualAsync("/api/v1/agent/ingest", body).thenAccept {
            SulcusNotify.info(project, "Sulcus Memory Stored", "Sent selection to System 1 pipeline ($ns).")
        }
    }
}

class SulcusToolWindowFactory : ToolWindowFactory {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val ns = SulcusClient.resolveNamespace(project)
        val rootPanel = JPanel(BorderLayout(8, 8))
        val header = JBLabel("Namespace: $ns | Engine: System 1")
        val outputArea = JBTextArea(12, 40).apply {
            isEditable = false
            lineWrap = true
            wrapStyleWord = true
            text = "Click 'Refresh Hot Context' to inspect active thermodynamic memories for '$ns'."
        }
        val refreshBtn = JButton("Refresh Hot Context").apply {
            addActionListener {
                val body = """{"query":"architecture conventions and active work","limit":8,"namespace":"${SulcusClient.escapeJson(ns)}"}"""
                SulcusClient.postDualAsync("/api/v1/agent/search", body).thenAccept { res ->
                    javax.swing.SwingUtilities.invokeLater {
                        outputArea.text = res ?: "Local sidecar offline on 127.0.0.1:4203. Start `sulcus serve` or configure Remote API Key in Settings -> Tools -> Sulcus Memory."
                    }
                }
            }
        }
        rootPanel.add(header, BorderLayout.NORTH)
        rootPanel.add(JBScrollPane(outputArea), BorderLayout.CENTER)
        rootPanel.add(refreshBtn, BorderLayout.SOUTH)

        val content = ContentFactory.getInstance().createContent(rootPanel, "", false)
        toolWindow.contentManager.addContent(content)
    }
}

class SulcusStatusBarWidgetFactory : StatusBarWidgetFactory {
    override fun getId(): String = "SulcusStatusBar"
    override fun getDisplayName(): String = "Sulcus Memory Namespace"
    override fun isAvailable(project: Project): Boolean = true
    override fun createWidget(project: Project): StatusBarWidget = object : StatusBarWidget, StatusBarWidget.TextPresentation {
        override fun ID(): String = "SulcusStatusBar"
        override fun getPresentation(): StatusBarWidget.WidgetPresentation = this
        override fun install(statusBar: StatusBar) {}
        override fun dispose() {}
        override fun getText(): String = "Sulcus: ${SulcusClient.resolveNamespace(project)}"
        override fun getTooltipText(): String = "Sulcus Memory Engine (System 1 + Junie MCP)"
        override fun getAlignment(): Float = 0.5f
    }
}
