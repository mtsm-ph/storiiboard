import { describe, expect, it } from 'vitest';
import { parseFdx } from './fdx';
import { parseFountain } from './fountain';
import { characterName, eighthsFromLength, looksLikeHeading, parseHeading } from './script';

const FOUNTAIN = `Title: Bey County
Credit: written by
Author: Kevin Matos

INT. DINER - NIGHT #1#

Rain on the windows. MARY (40s) wipes the counter.

MARY
We're closed.

TOM (O.S.)
Door was open.

MARY (CONT'D)
(not looking up)
Then close it on your way out.

EXT. COUNTY ROAD - DAY

A truck idles.

CUT TO:

INT./EXT. TRUCK - CONTINUOUS

TOM
Still raining.

.FLASHBACK - THE BRIDGE

/* a cut scene
INT. NOWHERE - DAY

NOBODY
Gone.
*/

[[ check the bridge permit ]]

int. barn - dawn

@McCLANE
Yippee.
`;

describe('scene headings', () => {
  it('reads INT/EXT, the place and the time of day by rule', () => {
    expect(parseHeading('INT. DINER - BACK ROOM - NIGHT')).toMatchObject({ intExt: 'INT', location: 'DINER - BACK ROOM', dayNight: 'NIGHT', otherTime: null });
    expect(parseHeading('EXT. COUNTY ROAD – DUSK')).toMatchObject({ intExt: 'EXT', location: 'COUNTY ROAD', dayNight: 'DUSK' });
    expect(parseHeading('I/E CAR - DAY')).toMatchObject({ intExt: 'INT/EXT', location: 'CAR', dayNight: 'DAY' });
    expect(parseHeading('EXT./INT. PORCH - SUNSET')).toMatchObject({ intExt: 'INT/EXT', location: 'PORCH', dayNight: 'DUSK' });
    expect(parseHeading('EST. BEY COUNTY')).toMatchObject({ intExt: 'EXT', location: 'BEY COUNTY', dayNight: null });
    expect(parseHeading('INT. HOUSE - MOMENTS LATER')).toMatchObject({ location: 'HOUSE', dayNight: null, otherTime: 'MOMENTS LATER' });
    expect(parseHeading('INT. GYM - NIGHT (1987)')).toMatchObject({ location: 'GYM', dayNight: 'NIGHT' });
    // No INT or EXT: only a real time of day is split off.
    expect(parseHeading('FLASHBACK - THE BRIDGE')).toMatchObject({ intExt: null, location: 'FLASHBACK - THE BRIDGE', otherTime: null });
    // The time of day wherever it falls among the dashes, and what follows it kept.
    expect(parseHeading('INT. KITCHEN - NIGHT - FLASHBACK')).toMatchObject({ location: 'KITCHEN', dayNight: 'NIGHT', otherTime: 'FLASHBACK' });
    expect(parseHeading('INT. DINER - BACK ROOM - NIGHT')).toMatchObject({ location: 'DINER - BACK ROOM', dayNight: 'NIGHT', otherTime: null });
  });

  it('names a character without extensions or the dual-dialogue mark', () => {
    expect(characterName("MARY (CONT'D)")).toBe('MARY');
    expect(characterName('TOM (V.O.) ^')).toBe('TOM');
    expect(characterName('DR.  GREEN')).toBe('DR. GREEN');
  });

  it('reads Final Draft’s scene lengths as eighths', () => {
    expect(eighthsFromLength('1 3/8')).toBe(11);
    expect(eighthsFromLength('4/8')).toBe(4);
    expect(eighthsFromLength('2')).toBe(16);
    expect(eighthsFromLength('')).toBeNull();
    expect(eighthsFromLength('long')).toBeNull();
  });
});

describe('Spanish scene headings (polish 7)', () => {
  const read = (heading: string) => {
    const h = parseHeading(heading);
    return [h.intExt, h.location, h.dayNight, h.otherTime];
  };

  it('reads the times of day Spanish scripts write, with or without accents', () => {
    expect(read('INT. CAFETERÍA - NOCHE')).toEqual(['INT', 'CAFETERÍA', 'NIGHT', null]);
    expect(read('EXT. PLAZA DE ARMAS - DÍA')).toEqual(['EXT', 'PLAZA DE ARMAS', 'DAY', null]);
    expect(read('EXT. PLAYA - DIA')).toEqual(['EXT', 'PLAYA', 'DAY', null]);
    expect(read('INT./EXT. AUTO - AMANECER')).toEqual(['INT/EXT', 'AUTO', 'DAWN', null]);
    expect(read('EXT. AZOTEA - ATARDECER')).toEqual(['EXT', 'AZOTEA', 'DUSK', null]);
    expect(read('EXT. CERRO - ANOCHECER')).toEqual(['EXT', 'CERRO', 'DUSK', null]);
    expect(read('EXT. MUELLE - HORA MÁGICA')).toEqual(['EXT', 'MUELLE', 'MAGIC HOUR', null]);
    // A time the board doesn't know is kept, so the heading still says it.
    expect(read('INT. CASA DE MARÍA - DÍA - MÁS TARDE')).toEqual(['INT', 'CASA DE MARÍA', 'DAY', 'MÁS TARDE']);
    expect(read('INT. CASA DE MARÍA - CONTINUO')).toEqual(['INT', 'CASA DE MARÍA', null, 'CONTINUO']);
    // A full stop after the time, sunrise and sunset in words, and an accent typed as a separate mark.
    expect(read('INT. CASA - NOCHE.')).toEqual(['INT', 'CASA', 'NIGHT', null]);
    expect(read('EXT. PLAYA - PUESTA DE SOL')).toEqual(['EXT', 'PLAYA', 'DUSK', null]);
    expect(read('EXT. CERRO - OCASO')).toEqual(['EXT', 'CERRO', 'DUSK', null]);
    expect(read('EXT. CAMPO - SALIDA DEL SOL')).toEqual(['EXT', 'CAMPO', 'DAWN', null]);
    expect(read('INT. CASA - DI\u0301A')).toEqual(['INT', 'CASA', 'DAY', null]);
    expect(characterName('MARI\u0301A (V.O.)')).toBe('MARÍA');
  });

  it('reads INTERIOR and EXTERIOR spelled out, in capitals as a heading writes them, and never an action line', () => {
    expect(read('INTERIOR CASA - NOCHE')).toEqual(['INT', 'CASA', 'NIGHT', null]);
    expect(read('EXTERIOR. CALLE - DÍA')).toEqual(['EXT', 'CALLE', 'DAY', null]);
    expect(read('INTERIOR/EXTERIOR TAXI - NOCHE')).toEqual(['INT/EXT', 'TAXI', 'NIGHT', null]);
    expect(looksLikeHeading('Exterior walls crumble into the sea.')).toBe(false);
    expect(looksLikeHeading('Interior del bar, lleno de humo.')).toBe(false);
    expect(looksLikeHeading('EXTERIOR CALLE - DÍA')).toBe(true);
  });

  it('imports a Spanish Fountain script by the same rules', () => {
    const script = parseFountain(`Title: El Condado

INT. CAFETERÍA - NOCHE #1#

La lluvia golpea los vidrios. MARÍA limpia el mostrador.

MARÍA
Ya cerramos.

EXTERIOR CARRETERA - ATARDECER

Un camión pasa.
`);
    expect(script.scenes.map((s) => [s.number, s.intExt, s.location, s.dayNight])).toEqual([
      ['1', 'INT', 'CAFETERÍA', 'NIGHT'],
      [null, 'EXT', 'CARRETERA', 'DUSK'],
    ]);
    expect(script.scenes[0]?.characters).toEqual(['MARÍA']);
  });
});

describe('a Fountain script', () => {
  const script = parseFountain(FOUNTAIN);

  it('finds every scene, its number when it has one, and leaves out the boneyard', () => {
    expect(script.title).toBe('Bey County');
    expect(script.scenes.map((s) => [s.number, s.intExt, s.location, s.dayNight ?? s.otherTime])).toEqual([
      ['1', 'INT', 'DINER', 'NIGHT'],
      [null, 'EXT', 'COUNTY ROAD', 'DAY'],
      [null, 'INT/EXT', 'TRUCK', 'CONTINUOUS'],
      [null, null, 'FLASHBACK - THE BRIDGE', null],
      [null, 'INT', 'barn', 'DAWN'],
    ]);
  });

  it('lists the speaking characters in order, not transitions or names in action', () => {
    expect(script.scenes.map((s) => s.characters)).toEqual([['MARY', 'TOM'], [], ['TOM'], [], ['McCLANE']]);
  });

  it('estimates a scene’s length from its printed lines, an eighth at least', () => {
    expect(script.scenes.every((s) => s.eighths >= 1)).toBe(true);
    // About two pages of action: 53 paragraphs, each a line and a blank.
    const long = `INT. HALL - DAY\n\n${Array.from({ length: 53 }, (_, i) => `Step ${String(i)}.`).join('\n\n')}\n`;
    expect(parseFountain(long).scenes[0]?.eighths).toBe(16);
  });

  it('reads Windows line ends and a byte-order mark the same', () => {
    expect(parseFountain(`\uFEFF${FOUNTAIN.replace(/\n/g, '\r\n')}`).scenes).toEqual(script.scenes);
  });

  it('needs a blank line round an unforced heading, so action that starts with INT isn’t one', () => {
    expect(parseFountain('EXT. FIELD - DAY\n\nInterior lights flick on.\nINT. is painted on the door.\n').scenes).toHaveLength(1);
    // Fountain has no INTERIOR or EXTERIOR: prose that starts with one is action.
    expect(parseFountain('EXT. FIELD - DAY\n\nExterior walls are cracked.\n\n').scenes).toHaveLength(1);
  });

  it('never takes a heading or a transition missing its blank line after for a speaker', () => {
    const script = parseFountain('EXT. FIELD - DAY\n\nINT. HOUSE - DAY\nMary enters.\n\nCUT TO:\nA field.\n');
    expect(script.scenes.flatMap((s) => s.characters)).toEqual([]);
  });

  it('keeps a speaker over a note on a line of its own, and counts wrapped action as one paragraph', () => {
    const script = parseFountain('INT. A - DAY\n\nMARY\n[[ louder? ]]\nHello.\n');
    expect(script.scenes[0]?.characters).toEqual(['MARY']);
    // A note that starts a line of text is only that note: nothing after it goes with it.
    const notes = parseFountain('INT. A - DAY\n\n[[draft]] Mary waits.\n\nINT. B - NIGHT\n\nTOM\nHi. [[louder]]\n');
    expect(notes.scenes.map((s) => [s.location, s.characters])).toEqual([
      ['A', []],
      ['B', ['TOM']],
    ]);
    // Two notes on a line of their own, and a [[ with a blank line after it, which isn't a note.
    expect(parseFountain('INT. A - DAY\n\nMARY\n[[a]] [[b]]\nHi.\n').scenes[0]?.characters).toEqual(['MARY']);
    expect(parseFountain('INT. A - DAY\n\n[[stray\n\nINT. B - DAY\n\nTOM\nHi.]]\n').scenes.map((s) => s.location)).toEqual(['A', 'B']);
    const wrapped = `INT. HALL - DAY\n\n${Array.from({ length: 53 }, (_, i) => `Step ${String(i)}.`).join('\n')}\n`;
    // 53 lines of one paragraph and one blank, not 106: about an eighth under a page.
    expect(parseFountain(wrapped).scenes[0]?.eighths).toBe(8);
  });
});

const FDX = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<FinalDraft DocumentType="Script" Template="No" Version="5">
<Content>
<Paragraph Number="4A" Type="Scene Heading">
<SceneProperties Length="1 3/8" Page="1" Title=""/>
<Text>INT. DINER - NIGHT</Text>
</Paragraph>
<Paragraph Type="Action"><Text>Rain &amp; wind.</Text></Paragraph>
<Paragraph Type="Character"><Text>MARY</Text></Paragraph>
<Paragraph Type="Dialogue"><Text>We&apos;re </Text><Text Style="Italic">closed</Text><Text>.</Text></Paragraph>
<Paragraph>
<DualDialogue>
<Paragraph Type="Character"><Text>TOM (V.O.)</Text></Paragraph>
<Paragraph Type="Dialogue"><Text>Open.</Text></Paragraph>
<Paragraph Type="Character"><Text>MARY</Text></Paragraph>
<Paragraph Type="Dialogue"><Text>Closed.</Text></Paragraph>
</DualDialogue>
</Paragraph>
<Paragraph Type="Scene Heading"><Text>EXT. COUNTY ROAD &#8211; DUSK</Text></Paragraph>
<Paragraph Type="Action"><Text>A truck.</Text></Paragraph>
</Content>
<TitlePage>
<Content>
<Paragraph Type="Text"><Text>Bey County</Text></Paragraph>
<Paragraph Type="Scene Heading"><Text>INT. TITLE PAGE - DAY</Text></Paragraph>
</Content>
</TitlePage>
</FinalDraft>`;

describe('a Final Draft script', () => {
  const script = parseFdx(FDX);

  it('reads its scenes, numbers and lengths from the script itself, not the title page', () => {
    expect(script.title).toBe('Bey County');
    expect(script.scenes.map((s) => [s.number, s.intExt, s.location, s.dayNight, s.eighths])).toEqual([
      ['4A', 'INT', 'DINER', 'NIGHT', 11],
      [null, 'EXT', 'COUNTY ROAD', 'DUSK', 1],
    ]);
  });

  it('finds speaking characters in dual dialogue too, once each', () => {
    expect(script.scenes[0]?.characters).toEqual(['MARY', 'TOM']);
  });

  it('says so when the file isn’t Final Draft', () => {
    expect(() => parseFdx('<html></html>')).toThrow('Final Draft');
  });

  it('skips an empty heading, reads CDATA, single quotes and a > in an attribute, and keeps a bad number as written', () => {
    const xml = `<FinalDraft><Content>
<Paragraph Type="Scene Heading"><Text></Text></Paragraph>
<Paragraph Type='Scene Heading' Number='3'><SceneProperties Title="A > B"/><Text><![CDATA[INT. BARN - DAWN]]></Text></Paragraph>
<Paragraph Type="Character"><Text>JO&#99999999;</Text></Paragraph><Paragraph Type="Dialogue"><Text>Hi.</Text></Paragraph>
</Content></FinalDraft>`;
    const read = parseFdx(xml);
    expect(read.scenes.map((s) => [s.number, s.location, s.dayNight])).toEqual([['3', 'BARN', 'DAWN']]);
    expect(read.scenes[0]?.characters).toEqual(['JO&#99999999;']);
    expect(read.title).toBeNull();
  });
});
