import { useRef, useState } from "react"
import { FolderTree, Layers, PanelRight, Settings2 } from "lucide-react"
import type { GitHubConnection, Project, ProjectInput } from "../ProjectsView"
import { ProjectSettings } from "../ProjectsView"
import { searchGitHubRepositories } from "../hooks/useProjects"
import { ArtefactsBrowserPanel } from "../panels/ArtefactsBrowserPanel"
import { FilesPanel } from "../panels/FilesPanel"
import { PaneResizer } from "./PaneResizer"
import { useI18n } from "../i18n/I18nContext"

const PROJECT_PANE_STANDARD = 320

export type ProjectRightPaneMode = "files" | "artifacts" | "settings" | null

export function ProjectRightInspector({
  project,
  pane,
  activeEnvironmentName,
  initialDraft,
  githubConnection,
  githubStatusError,
  onSetPane,
  onClose,
  onClearUnread,
  onOpenSession,
  onOpenGitHubSettings,
  onSaveProject,
}: {
  project: Project
  pane: ProjectRightPaneMode
  activeEnvironmentName: string
  initialDraft?: ProjectInput
  githubConnection: GitHubConnection | null
  githubStatusError: string
  onSetPane: (pane: ProjectRightPaneMode) => void
  onClose: () => void
  onClearUnread: (id: string) => void
  onOpenSession: (id: string) => void
  onOpenGitHubSettings: (draftInput: ProjectInput) => void
  onSaveProject: (input: ProjectInput) => Promise<Project>
}) {
  const { t } = useI18n()
  const [projectPaneWidth, setProjectPaneWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem("ade.project-pane-width"))
      return saved >= 260 && saved <= 760 ? saved : PROJECT_PANE_STANDARD
    } catch {
      return PROJECT_PANE_STANDARD
    }
  })
  const projectPaneRef = useRef<HTMLElement | null>(null)

  return (
    <>
      {pane ? (
        <PaneResizer
          width={projectPaneWidth}
          min={260}
          max={760}
          standard={PROJECT_PANE_STANDARD}
          paneRef={projectPaneRef}
          label={t("wsx.layout.resizeProjectPanel")}
          onChange={width => {
            setProjectPaneWidth(width)
            try { localStorage.setItem("ade.project-pane-width", String(width)) } catch { /* private mode */ }
          }}
        />
      ) : null}
      <aside
        ref={pane !== "settings" ? projectPaneRef : undefined}
        style={{ width: projectPaneWidth }}
        id="project-files-panel"
        className="inspector ade-project-files-inspector"
        aria-label={pane === "artifacts" ? t("wsx.layout.projectArtefacts") : t("wsx.layout.projectFiles")}
        hidden={pane !== "files" && pane !== "artifacts"}
      >
        <div className="ade-project-right-head">
          <div className="ade-project-right-tabs" role="tablist" aria-label={t("wsx.layout.rightPanelView")}>
            <button
              type="button"
              role="tab"
              aria-selected={pane === "files"}
              className={`ade-project-right-tab ${pane === "files" ? "is-active" : ""}`}
              onClick={() => onSetPane("files")}
            >
              <FolderTree className="size-3.5" /> {t("wsx.layout.files")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={pane === "artifacts"}
              className={`ade-project-right-tab ${pane === "artifacts" ? "is-active" : ""}`}
              onClick={() => onSetPane("artifacts")}
            >
              <Layers className="size-3.5" /> {t("wsx.layout.artefacts")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={false}
              className="ade-project-right-tab"
              onClick={() => onSetPane("settings")}
            >
              <Settings2 className="size-3.5" /> {t("wsx.layout.settings")}
            </button>
          </div>
          <button
            type="button"
            className="ade-icon-btn"
            aria-label={t("wsx.layout.closeRightPanel")}
            title={t("wsx.layout.closePanel")}
            onClick={onClose}
          >
            <PanelRight className="size-4" />
          </button>
        </div>
        {pane === "artifacts" ? (
          <ArtefactsBrowserPanel
            key={`proj-artefacts:${project.id}`}
            scope="project"
            projectId={project.id}
            workspacePath={project.repository ?? null}
            onOpenSession={id => { onClearUnread(id); onOpenSession(id) }}
          />
        ) : (
          <FilesPanel
            key={project.id}
            projectId={project.id}
            workspacePath={project.repository ?? null}
            onOpenSettings={() => onSetPane("settings")}
          />
        )}
      </aside>
      <ProjectSettings
        key={project.id}
        width={projectPaneWidth}
        paneRef={pane === "settings" ? projectPaneRef : undefined}
        project={project}
        environmentName={activeEnvironmentName}
        initialDraft={initialDraft}
        open={pane === "settings"}
        githubConnection={githubConnection}
        githubStatusError={githubStatusError}
        onOpenSettings={onOpenGitHubSettings}
        onSearchRepositories={searchGitHubRepositories}
        onClose={onClose}
        onSave={onSaveProject}
      />
    </>
  )
}
