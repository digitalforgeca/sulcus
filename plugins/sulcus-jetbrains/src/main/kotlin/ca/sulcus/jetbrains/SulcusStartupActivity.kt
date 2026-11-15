package ca.sulcus.jetbrains

import com.intellij.ide.trustedProjects.TrustedProjects
import com.intellij.ide.trustedProjects.TrustedProjectsLocator
import com.intellij.openapi.project.Project
import com.intellij.openapi.startup.ProjectActivity

class SulcusStartupActivity : ProjectActivity {
    override suspend fun execute(project: Project) {
        // Respect JetBrains Project Trust: never inspect or phone home from untrusted checkouts
        if (!TrustedProjects.isProjectTrusted(TrustedProjectsLocator.locateProject(project))) {
            return
        }

        SulcusClient.resolveMachineId()
        SulcusClient.resolveNamespace(project)
    }
}
