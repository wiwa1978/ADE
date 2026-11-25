import type { FormEvent } from "react"
import { Button, Input } from "@/components/ui"
import type { useConnections } from "../../useConnections"
import { useI18n } from "../../i18n/I18nContext"
import type { UnifiedProviderItem } from "./provider-overrides"

export interface ProviderAuthSectionProps {
  item: UnifiedProviderItem
  connections: ReturnType<typeof useConnections>
  sending: boolean
  credentialDisabled: boolean
  editingKey: string | null
  onEditingKeyChange: (next: string | null) => void
  compatible: { url: string; model: string; fromEnvironment: boolean } | null
  compatibleDraft: { url: string; model: string }
  compatibleBusy: boolean
  compatibleMessage: string
  onCompatibleDraftChange: (next: { url: string; model: string }) => void
  onSaveCompatible: (event: FormEvent<HTMLFormElement>) => Promise<void>
  onModelsChanged?: () => void
}

export function ProviderAuthSection({
  item,
  connections,
  sending,
  credentialDisabled,
  editingKey,
  onEditingKeyChange,
  compatible,
  compatibleDraft,
  compatibleBusy,
  compatibleMessage,
  onCompatibleDraftChange,
  onSaveCompatible,
  onModelsChanged,
}: ProviderAuthSectionProps) {
  const { t } = useI18n()
  const {
    copilotHealth,
    copilotStatusError,
    copilotSignIn,
    copilotWaiting,
    authBusy,
    changeCopilotAuth,
    modelCredentialBusy,
    saveModelCredential,
    changeModelCredential,
  } = connections

  if (item.kind === "copilot") {
    return (
      <div className="st-prov-section">
        <div className="st-prov-section-title">{t("prov.authentication")}</div>
        <div className="st-prov-field-row">
          <div className="st-prov-field-text">
            <label>{t("prov.copilotSubscription")}</label>
            <p>
              {copilotWaiting && copilotSignIn?.code && copilotSignIn.url ? (
                <>
                  {t("prov.copilotOpen", { link: "§L§", code: "§C§" }).split(/(§[LC]§)/).map((part, index) =>
                    part === "§L§" ? (
                      <a key={index} href={copilotSignIn.url} target="_blank" rel="noreferrer">github.com/login/device</a>
                    ) : part === "§C§" ? (
                      <strong key={index}>{copilotSignIn.code}</strong>
                    ) : (
                      part
                    ),
                  )}
                </>
              ) : (
                t("prov.copilotUses")
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="primary"
              size="sm"
              disabled={authBusy || !copilotHealth || Boolean(copilotStatusError) || sending}
              onClick={() => void changeCopilotAuth(copilotWaiting ? "cancel" : "start")}
            >
              {copilotWaiting ? t("common.cancel") : copilotHealth?.copilotSignedIn ? t("prov.reconnect") : t("prov.signIn")}
            </Button>
            {!copilotWaiting && copilotHealth?.copilotSignedIn ? (
              <Button variant="outline" size="sm" disabled={authBusy || sending} onClick={() => void changeCopilotAuth("sign-out")}>
                {t("prov.signOut")}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  if (!item.credentialProvider) return null

  const provider = item.credentialProvider
  const isEditing = editingKey === provider
  const isRemoving = modelCredentialBusy?.provider === provider && modelCredentialBusy.action === "remove"
  const isSaving = modelCredentialBusy?.provider === provider && modelCredentialBusy.action === "save"

  return (
    <div className="st-prov-section">
      <div className="st-prov-section-title">{t("prov.authentication")}</div>
      <div className="st-prov-field-row">
        <div className="st-prov-field-text">
          <label>{t("prov.apiKey")}</label>
          <p>{t("prov.apiKeyHint")}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!isEditing ? (
            <Button variant="secondary" size="sm" disabled={credentialDisabled} onClick={() => onEditingKeyChange(provider)}>
              {item.credentialSource === "saved" ? t("prov.replaceKey") : t("prov.addKey")}
            </Button>
          ) : null}
          {item.credentialSource === "saved" && !isEditing ? (
            <Button
              variant="outline"
              size="sm"
              loading={isRemoving}
              disabled={credentialDisabled}
              onClick={async () => {
                await changeModelCredential("remove", provider)
                onModelsChanged?.()
              }}
            >
              {isRemoving ? t("prov.removing") : t("common.remove")}
            </Button>
          ) : null}
        </div>
      </div>

      {isEditing ? (
        <form
          className="flex items-center gap-2 mt-2"
          onSubmit={async event => {
            await saveModelCredential(event, provider)
            onEditingKeyChange(null)
            onModelsChanged?.()
          }}
        >
          <Input
            name="apiKey"
            type="password"
            className="flex-1"
            autoFocus
            autoComplete="new-password"
            maxLength={4096}
            placeholder={t("prov.keyFor", { name: item.name })}
            required
            disabled={credentialDisabled}
            aria-label={t("prov.keyFor", { name: item.name })}
          />
          <Button type="submit" variant="primary" size="sm" loading={isSaving} disabled={credentialDisabled}>
            {isSaving ? t("common.saving") : t("common.save")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => onEditingKeyChange(null)}>
            {t("common.cancel")}
          </Button>
        </form>
      ) : null}

      {provider === "compatible" ? (
        <form className="flex flex-col gap-3 mt-3 pt-3 border-t border-[rgb(var(--border)/0.7)]" onSubmit={event => void onSaveCompatible(event)}>
          <div className="st-prov-field-row">
            <div className="st-prov-field-text">
              <label htmlFor="compat-url">{t("prov.endpointUrl")}</label>
              <p>{t("prov.endpointHint")}</p>
            </div>
            <Input
              id="compat-url"
              className="st-prov-field-input"
              value={compatibleDraft.url}
              onChange={e => onCompatibleDraftChange({ ...compatibleDraft, url: e.target.value })}
              placeholder="http://127.0.0.1:11434/v1"
              disabled={compatible?.fromEnvironment || compatibleBusy}
            />
          </div>
          <div className="st-prov-field-row">
            <div className="st-prov-field-text">
              <label htmlFor="compat-model">{t("prov.defaultModelId")}</label>
              <p>{t("prov.defaultModelHint")}</p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                id="compat-model"
                className="!w-[165px]"
                value={compatibleDraft.model}
                onChange={e => onCompatibleDraftChange({ ...compatibleDraft, model: e.target.value })}
                placeholder="llama3.2"
                disabled={compatible?.fromEnvironment || compatibleBusy}
              />
              <Button type="submit" variant="primary" size="sm" loading={compatibleBusy} disabled={compatible?.fromEnvironment}>
                {compatibleBusy ? t("common.saving") : t("common.save")}
              </Button>
            </div>
          </div>
          {compatibleMessage ? <span className="st-hint" role="status">{compatibleMessage}</span> : null}
        </form>
      ) : null}
    </div>
  )
}
