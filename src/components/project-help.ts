import { icon } from '../services/icons';
import { html } from '../utils';
import { kakapoLogoUrl, kakapoCreditHtml, aiCreditHtml, bindExternalLinks } from '../services/credits';

const KBD_STYLE =
  'font-family: var(--font-mono); font-weight: 700; background: var(--color-bg-surface-raised); padding: 1px 6px; border-radius: var(--radius-xs); border: 1px solid var(--color-border);';

/** A keyboard key, drawn like a key cap. */
const kbd = (key: string): string => `<kbd style="${KBD_STYLE}">${key}</kbd>`;

/** One shortcut row in the quick reference. */
const shortcut = (title: string, detail: string, keys: string): string => html`
  <div class="inner-card" style="padding: var(--space-3); flex-direction: row; align-items: center; justify-content: space-between;">
    <div class="flex flex-col">
      <span class="text-xs font-semibold text-main">${title}</span>
      <span class="text-muted" style="font-size: 11px;">${detail}</span>
    </div>
    <span style="background: var(--color-bg-surface-raised); border: 1px solid var(--color-border); padding: 2px 10px; border-radius: var(--radius-sm); font-family: var(--font-mono); font-size: var(--text-xs); font-weight: 700; white-space: nowrap;">${keys}</span>
  </div>`;

/** A titled card holding one or two columns of short bullet lists. */
const section = (title: string, iconName: string, intro: string, columns: { heading: string; items: string[] }[]): string => html`
  <div class="surface-card">
    <strong class="text-md text-main inline-flex items-center gap-2">${icon(iconName)} ${title}</strong>
    <p class="help-prose">${intro}</p>
    <div class="grid-cols-2 gap-4" style="display: grid;">
      ${columns.map(c => html`
        <div class="inner-card flex flex-col gap-2">
          <strong class="text-xs text-main">${c.heading}</strong>
          <ul class="help-list" style="margin-top: 4px;">
            ${c.items.map(i => `<li>${i}</li>`).join('')}
          </ul>
        </div>`).join('')}
    </div>
  </div>`;

export class ProjectHelp extends HTMLElement {
  connectedCallback(): void {
    this.render();
  }

  private render(): void {
    this.innerHTML = html`
      <div class="page-container" style="max-width: 1100px;">
        <div>
          <h1 style="font-size: var(--text-2xl); font-weight: 700; color: var(--color-text-main);">How to use TRAAACE</h1>
          <p class="text-muted text-sm mt-1" style="line-height: 1.7;">
            How to use TRAAACE to tag your trail camera photos and videos, in plain language.
            Everything stays on your computer.
          </p>
        </div>

        ${section('Two ways to work', 'bolt',
          'When TRAAACE starts you choose one. You can switch later.',
          [
            {
              heading: 'Quick Classify',
              items: [
                'Best for a single card or folder you want to tag and export now.',
                'Nothing is kept inside TRAAACE. <strong>Export before you close</strong>, or your tags are lost.',
                'To switch, close the session (the red <strong>Close</strong> button), or use <em>Switch workspace…</em> in Settings.',
              ],
            },
            {
              heading: 'Project Library',
              items: [
                'Best for ongoing monitoring with many folders and cameras.',
                'Your folders and tags are saved on this computer as you go. Close the app and carry on later.',
                'Adds charts (Insights), your own species keys and comments, and combined exports.',
              ],
            },
          ])}

        ${section('Quick Classify, step by step', 'photo',
          'From a folder of photos to a finished spreadsheet.',
          [
            {
              heading: 'Getting started',
              items: [
                '<strong>1.</strong> Drag a folder or SD card onto the window, or click it to browse. Photos and videos are both found.',
                '<strong>2.</strong> Check the <strong>Location / Site Name</strong>. It starts as the folder name, and it goes into your spreadsheet.',
                '<strong>3.</strong> Before you start you can change the nine species keys and the comment shortcuts on the same screen.',
                '<strong>4.</strong> Press <strong>Start Quick Classify</strong> and tag your photos (see the next section).',
              ],
            },
            {
              heading: 'Finishing',
              items: [
                'Press <strong>Export</strong> (top of the right-hand panel), or ' + kbd('Ctrl') + ' / ' + kbd('Cmd') + ' + ' + kbd('E') + '.',
                'Pick a folder, then which reports you want: Excel, CSV, text summary or JSON.',
                'Choose what happens to the photos: leave them, <strong>copy</strong> them to the export folder, or <strong>move</strong> them (moving takes them off the card).',
                'Tick <em>organise by species</em> to sort the copied photos into one folder per species.',
              ],
            },
          ])}

        ${section('Tagging photos', 'keyboard',
          'Everything can be done from the keyboard. Each tag saves straight away.',
          [
            {
              heading: 'Tagging',
              items: [
                kbd('1') + '–' + kbd('9') + ' tag the photo with the species on that key, then move to the next photo.',
                kbd('Space') + ' tags the photo as <strong>Empty</strong> (nothing there, or a false trigger).',
                kbd('/') + ' lets you type any other species name.',
                kbd('+') + ' and ' + kbd('−') + ' change the number of animals in the photo.',
                '<strong>Auto-Advance</strong> moves on after each tag. Use the slider beside it to wait up to 3 seconds first, so you can still add a count or a comment.',
              ],
            },
            {
              heading: 'Looking closely',
              items: [
                kbd('←') + ' and ' + kbd('→') + ' move between photos without changing any tag.',
                kbd('G') + ' switches between one big photo and a grid of thumbnails.',
                'Scroll the mouse wheel to zoom in, then drag to move around. <strong>Fit</strong> shows the whole photo again.',
                'Videos are paused at the start. Click the picture or the play button to watch, and use the bar to skip. Some video types can\'t be played inside TRAAACE, but you can still tag them.',
                'Drag the edge of the right-hand panel to make it wider or narrower.',
              ],
            },
          ])}

        ${section('Comments, dates and clocks', 'message',
          'Add a note to a photo, or correct a camera clock that is wrong.',
          [
            {
              heading: 'Comments',
              items: [
                'Press ' + kbd('C') + ' to jump to the comment box.',
                'Use ' + kbd('↑') + ' ' + kbd('↓') + ' to pick a ready-made comment and ' + kbd('Enter') + ' to add it. Or just type your own, such as <em>"Ear tag 42"</em>.',
                'Comments end up in the <strong>Comment</strong> column of your spreadsheet.',
              ],
            },
            {
              heading: 'Fixing a wrong date or time',
              items: [
                'Click the pencil beside the date above the photo.',
                'Set the correct date and time for that photo.',
                'Tick <em>Shift all subsequent photos by the same offset</em> to move every later photo by the same amount. This is the quick way to fix a clock that was set wrong.',
              ],
            },
          ])}

        ${section('Project Library: your folders', 'folder-open',
          'In the Projects tab, choose one <strong>Working Folder</strong> that holds a subfolder for each camera or site. TRAAACE finds them for you.',
          [
            {
              heading: 'How your folders are found',
              items: [
                'Every subfolder of the Working Folder becomes a card in the list. Camera card layouts with a <code>DCIM</code> folder are found too.',
                'Set where exports go in <strong>Export Folder</strong>, on the same page.',
                'Click a folder\'s site name to change its location. It is used in charts and exports.',
              ],
            },
            {
              heading: 'What the labels mean',
              items: [
                '<strong>Unclassified:</strong> nothing tagged yet.',
                '<strong>In Progress:</strong> some photos tagged. Open it again and carry on.',
                '<strong>Archived:</strong> every photo is tagged, or the photos have been moved off this computer. Your tags are kept either way.',
                '<strong>Exported:</strong> the folder has been exported.',
                '<strong>Removing a folder</strong> deletes its tags from TRAAACE. If the folder is still inside your Working Folder, it will appear again, untagged. Your photos are only deleted if you tick the box that says so.',
              ],
            },
          ])}

        ${section('Species & Keys (Project Library)', 'label-important',
          'Choose which species sit on which keys, and keep a list of ready-made comments.',
          [
            {
              heading: 'Your species keys',
              items: [
                'The top nine species in the list are keys ' + kbd('1') + '–' + kbd('9') + '. ' + kbd('Space') + ' is always Empty.',
                'Drag a row, or use the ▲ ▼ buttons, to move a species up or down. Put the animals you see most in the first few spots.',
                '<strong>Add Keymap / Species</strong> adds a species and the key or letters to press for it.',
                'A shortcut can be one letter or a few (for example P and PG). If two start the same way, TRAAACE waits a moment for the next key.',
                '<strong>Delete</strong> removes one. <strong>Reset Keys to Defaults</strong> brings back the New Zealand starter list.',
              ],
            },
            {
              heading: 'Comment presets',
              items: [
                'Add your own with <strong>Add Comment Preset</strong>, or remove ones you never use.',
                'The starter list is: False trigger, Multiple animals, Poor quality / blurry, Juvenile / young in frame, Injured animal, Camera moved / obstruction.',
                '<strong>Reset Comments</strong> returns to that list.',
              ],
            },
          ])}

        ${section('Insights', 'chart',
          'Charts built from the photos you have tagged. Nothing to set up.',
          [
            {
              heading: 'What you can see',
              items: [
                'Summary boxes: how many camera triggers there were, how many animals were counted, the busiest hours, and the most common species.',
                '<strong>Observation Activity Over Time:</strong> bars across the dates you chose. Hover a bar for its exact number.',
                '<strong>Species Composition:</strong> which species make up your detections.',
                '<strong>24-Hour Activity Rhythm:</strong> when animals are active, shaded by night, dawn, day and dusk.',
                '<strong>Camera Sites:</strong> how busy each site is.',
              ],
            },
            {
              heading: 'Narrowing it down',
              items: [
                'Pick <strong>Week, Month, Year, All</strong> or <strong>Custom</strong> to choose your own start and end dates.',
                'Filter by site, project, species, or by photos and videos.',
                '<strong>Animals</strong> counts every animal. <strong>Frames</strong> counts photos or videos that had something in them.',
              ],
            },
          ])}

        ${section('AI suggestions (optional)', 'paw',
          'TRAAACE can suggest the species and number of animals in each photo or video. It all happens on your computer; nothing is uploaded.',
          [
            {
              heading: 'Setting up',
              items: [
                'Click <strong>Set up AI…</strong> in the AI suggestions box on the right. TRAAACE downloads the AI add-on (about 520 MB) once, and checks it before installing.',
                'Works on Macs with Apple Silicon (M1 or newer), Windows and Linux. Not on Intel Macs.',
                'To take it off again, open the same window and choose <strong>Remove the add-on…</strong>.',
              ],
            },
            {
              heading: 'Using it',
              items: [
                'Open a folder and press <strong>Scan … with AI</strong>. A photo takes a few seconds on most computers, much less on an Apple Silicon Mac. Videos are checked a frame every half second.',
                'Each photo shows the best guess and how sure the AI is. Press <strong>Accept</strong> to tag it, or pick one of the other guesses. <strong>Accept … suggestions</strong> tags all the confident ones at once.',
                'The AI never tags anything by itself. Check its guesses, especially for animals that look alike, such as stoat and weasel, or rat and mouse.',
                'A species without its own key counts under your <strong>Bird</strong> or <strong>Other</strong> key. Your spreadsheet keeps the exact species.',
              ],
            },
          ])}

        ${section('Exporting, backups and importing', 'table-export',
          'Get your results out, and keep a safe copy.',
          [
            {
              heading: 'Exporting from a project',
              items: [
                'Tick one or more folders on the Projects tab, then press <strong>Export Selected</strong>. Several folders can go into one combined spreadsheet.',
                'You can also copy the photos, either sorted into a folder per species or kept in their original folders.',
                'Every spreadsheet has these columns: Folder, File, Media Type, Site Name, Date, Time, Species, Animal Count, Comment.',
              ],
            },
            {
              heading: 'Settings',
              items: [
                '<strong>Backup &amp; Restore</strong> saves everything TRAAACE has stored into one zip file, and restores it later or on another computer.',
                '<strong>CSV Import</strong> brings in results from an earlier TRAAACE export or your own spreadsheet.',
                '<strong>Interface Scaling</strong> makes everything bigger or smaller. ' + kbd('Ctrl') + ' / ' + kbd('Cmd') + ' with ' + kbd('+') + ', ' + kbd('−') + ' or ' + kbd('0') + ' works anywhere.',
                kbd('F11') + ' switches full screen on and off.',
                '<strong>Welcome Screen</strong> lets you choose whether it shows every time TRAAACE starts.',
              ],
            },
          ])}

        <div class="surface-card">
          <strong class="text-md text-main inline-flex items-center gap-2">${icon('keyboard')} Shortcuts at a glance</strong>
          <div class="grid-cols-2 gap-3" style="display: grid;">
            ${shortcut('Tag with a species', 'Then move to the next photo', '1–9')}
            ${shortcut('Empty / false trigger', 'Tag as Empty', 'Space')}
            ${shortcut('Type another species', 'For anything not on a key', '/')}
            ${shortcut('Number of animals', 'Add or take away one', '+ / −')}
            ${shortcut('Previous / next photo', 'Does not change any tag', '← / →')}
            ${shortcut('Single photo or grid', 'Switch the view', 'G')}
            ${shortcut('Add a comment', 'Then ↑ ↓ to pick, Enter to add', 'C')}
            ${shortcut('Export (Quick Classify)', 'Opens the export window', 'Ctrl/Cmd + E')}
            ${shortcut('Make everything bigger or smaller', 'Back to normal with 0', 'Ctrl/Cmd + + / −')}
            ${shortcut('Full screen', 'Press again to leave', 'F11')}
          </div>
        </div>

        <div class="surface-card" style="flex-direction: row; align-items: center; gap: var(--space-3);">
          <img src="${kakapoLogoUrl}" alt="" width="28" height="28" draggable="false" style="flex-shrink: 0;" />
          <div class="flex flex-col">
            <strong class="text-xs text-main">Credits</strong>
            <span class="text-muted" style="font-size: 11px;">${kakapoCreditHtml()}</span>
            <span class="text-muted" style="font-size: 11px;">${aiCreditHtml()}</span>
          </div>
        </div>
      </div>
    `;
    bindExternalLinks(this);
  }
}

customElements.define('project-help', ProjectHelp);

declare global {
  interface HTMLElementTagNameMap {
    'project-help': ProjectHelp;
  }
}
