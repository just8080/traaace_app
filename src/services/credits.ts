import kakapoLogo from '../assets/noun_kakapo_7103110.svg';
import { openExternalUrl } from './tauri-bridge';

/** The kakapo logo. Licensed CC BY 3.0, so the credit below must stay wherever it is shown. */
export const kakapoLogoUrl: string = kakapoLogo;

export const KAKAPO_CREDIT_TEXT = 'Kakapo by Cimrin from Noun Project (CC BY 3.0)';
const KAKAPO_CREDIT_URL = 'https://thenounproject.com/browse/icons/term/kakapo/';

/** The attribution line, with "Noun Project" as a link (opened by `bindExternalLinks`). */
export const kakapoCreditHtml = (): string =>
  `Kakapo by Cimrin from <a href="${KAKAPO_CREDIT_URL}" data-external title="kakapo Icons">Noun Project</a> (CC BY 3.0)`;

/** The AI add-on's credit line: the model authors asked to be thanked, with links (opened by `bindExternalLinks`). */
export const aiCreditHtml = (): string =>
  `AI suggestions: <a href="https://github.com/Wologman/Alita" data-external>Alita</a> by Olly and wekaResearch, with the ` +
  `Department of Conservation Predator Science team, and ` +
  `<a href="https://github.com/agentmorris/MegaDetector" data-external>MegaDetector</a> by Dan Morris and contributors`;

/** Makes `a[data-external]` links open in the system browser; a webview would otherwise ignore target=_blank. */
export function bindExternalLinks(root: ParentNode): void {
  root.querySelectorAll<HTMLAnchorElement>('a[data-external]').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      void openExternalUrl(a.href);
    });
  });
}
