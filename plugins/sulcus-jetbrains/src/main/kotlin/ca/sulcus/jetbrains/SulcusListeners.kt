package ca.sulcus.jetbrains

import com.intellij.execution.ExecutionListener
import com.intellij.execution.process.ProcessAdapter
import com.intellij.execution.process.ProcessEvent
import com.intellij.execution.process.ProcessHandler
import com.intellij.execution.runners.ExecutionEnvironment
import com.intellij.ide.trustedProjects.TrustedProjects
import com.intellij.ide.trustedProjects.TrustedProjectsLocator
import com.intellij.openapi.util.Key

class SulcusExecutionListener : ExecutionListener {
    override fun processStarted(executorId: String, env: ExecutionEnvironment, handler: ProcessHandler) {
        val project = env.project
        if (!TrustedProjects.isProjectTrusted(TrustedProjectsLocator.locateProject(project))) return
        if (!SulcusSettingsState.getInstance().autoCaptureTestFailures) return

        val runName = env.runProfile.name
        val buffer = StringBuilder()

        handler.addProcessListener(object : ProcessAdapter() {
            override fun onTextAvailable(event: ProcessEvent, outputType: Key<*>) {
                if (buffer.length < 32_768) {
                    buffer.append(event.text)
                }
            }

            override fun processTerminated(event: ProcessEvent) {
                if (event.exitCode == 0) return
                val compacted = SulcusClient.compactRubyRunOutput(runName, buffer.toString(), event.exitCode)
                    ?: return
                val ns = SulcusClient.resolveNamespace(project)
                val basePath = project.basePath ?: ""
                val harness = if (SulcusClient.isRubyOrRailsProject(project)) "rubymine" else "jetbrains"
                val ingestJson = """
                    {
                      "assistant_output": "${SulcusClient.escapeJson(compacted)}",
                      "namespace": "${SulcusClient.escapeJson(ns)}",
                      "conversation_id": "$harness-${project.locationHash}",
                      "harness": "$harness",
                      "workspace_root": "${SulcusClient.escapeJson(basePath)}",
                      "is_compaction": false
                    }
                """.trimIndent()
                SulcusClient.postDualAsync("/api/v1/agent/ingest", ingestJson)
            }
        })
    }
}
