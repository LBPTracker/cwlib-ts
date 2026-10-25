/**
 * The game's text-serialised resources: a four-character magic on the first
 * line (`GSBt`, `DLCt`), then one field per line, indented with tabs to its
 * depth, its name and its value apart by tabs or spaces. An array is a line
 * `Name<count>` and then `count` elements one level deeper, each `[i]` --
 * alone, when the element is a struct whose fields follow a level deeper
 * still, or with the element's value beside it.
 *
 * ❗ **cwlib reads none of this.** Its `RGuidSubst` parses another text layout
 * and its `RDLC` the binary one; this is a reading of our own, proven by the
 * typed readers that use it consuming every line of every one of the game's
 * files (steering/level-files.md, *Text resources*).
 *
 * ⚠️ **The files were edited by hand**, and it shows: one file names a field
 * `Flags` on most elements and `flags` on others, and lines carry stray tabs
 * and spaces after their value. Names are matched without case, and any run of
 * tabs and spaces separates. One file, `inventory_auto_pickup.gsub`, closes its
 * lines with `# comments`: a `#` outside quotes ends the line.
 */

import { SerializerError } from './serializer.ts';

interface Line {
  readonly number: number;
  readonly depth: number;
  readonly name: string;
  readonly value: string;
}

/**
 * One field of a text resource read without its schema: its name, its value as
 * written, and below it either an array's elements -- each with the value on
 * its `[i]` line and the fields under that -- or a struct's own fields, as a
 * descriptor's `GUID` and `Hash` sit under its path.
 */
export interface TextField {
  readonly name: string;
  readonly value: string;
  readonly elements?: readonly TextElement[];
  readonly fields?: readonly TextField[];
}

export interface TextElement {
  readonly value: string;
  readonly fields: readonly TextField[];
}

/** What a written value is: a quoted string, `true`/`false`, a number, or numbers apart by commas. */
export function textValue(raw: string): string | boolean | number | number[] {
  if (/^".*"$/.test(raw)) return raw.slice(1, -1);
  if (raw === 'true' || raw === 'false') return raw === 'true';
  const number = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;
  if (number.test(raw)) return Number(raw);
  const parts = raw.split(',');
  if (parts.length > 1 && parts.every((p) => number.test(p.trim()))) return parts.map((p) => Number(p.trim()));
  return raw;
}

/** A line up to a `#` that is not inside a quoted string. */
function withoutComment(line: string): string {
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === '#' && !quoted) return line.slice(0, i);
  }
  return line;
}

/** Walks a text resource's lines in order, each read checked against what it should be. */
export class TextResource {
  readonly magic: string;
  private readonly lines: Line[] = [];
  private at = 0;

  constructor(bytes: Uint8Array) {
    const text = new TextDecoder('latin1').decode(bytes);
    const raw = text.split(/\r?\n/);
    this.magic = raw[0];
    for (let i = 1; i < raw.length; i += 1) {
      const line = withoutComment(raw[i]);
      if (line.trim() === '') continue;
      let depth = 0;
      while (line[depth] === '\t') depth += 1;
      const rest = line.slice(depth).trimEnd();
      const split = rest.search(/[\t ]/);
      const name = split < 0 ? rest : rest.slice(0, split);
      const value = split < 0 ? '' : rest.slice(split).trim();
      this.lines.push({ number: i + 1, depth, name, value });
    }
  }

  private next(depth: number, name: string): Line {
    const line = this.lines[this.at];
    if (!line) throw new SerializerError(`${this.magic}: the file ends where "${name}" should be`);
    if (line.depth !== depth || line.name.toLowerCase() !== name.toLowerCase()) {
      throw new SerializerError(
        `${this.magic} line ${line.number}: "${line.name}" at depth ${line.depth}, not "${name}" at ${depth}`,
      );
    }
    this.at += 1;
    return line;
  }

  /** Whether the next line is this field: for one a later build added, the text form having no revision. */
  has(depth: number, name: string): boolean {
    const line = this.lines[this.at];
    return line !== undefined && line.depth === depth && line.name.toLowerCase() === name.toLowerCase();
  }

  /** A field's value as written: a quoted string keeps its quotes. */
  raw(depth: number, name: string): string {
    return this.next(depth, name).value;
  }

  int(depth: number, name: string): number {
    const { value, number } = this.next(depth, name);
    if (!/^-?\d+$/.test(value)) throw new SerializerError(`${this.magic} line ${number}: "${value}" is no integer`);
    return Number(value);
  }

  /** A decimal number, integer or not: `1`, `2.18`. */
  number(depth: number, name: string): number {
    const { value, number } = this.next(depth, name);
    if (!/^-?\d+(\.\d+)?$/.test(value)) throw new SerializerError(`${this.magic} line ${number}: "${value}" is no number`);
    return Number(value);
  }

  /** `true` or `false`. */
  bool(depth: number, name: string): boolean {
    const { value, number } = this.next(depth, name);
    if (value !== 'true' && value !== 'false') throw new SerializerError(`${this.magic} line ${number}: "${value}" is no bool`);
    return value === 'true';
  }

  /** A quoted string, unquoted; nothing in the game's files escapes a quote. */
  string(depth: number, name: string): string {
    const { value, number } = this.next(depth, name);
    if (!/^".*"$/.test(value)) throw new SerializerError(`${this.magic} line ${number}: ${value} is no string`);
    return value.slice(1, -1);
  }

  /**
   * An array: its count line, then each `[i]` read by `element` at `depth + 1`.
   *
   * ❗ **Every `[n]` line that follows is an element, whatever the count says.**
   * Two of the 01.28 update's `DLCt`s disagree with themselves: `c8f4e0ad`'s
   * `GUIDS` says 2,377 and 2,378 follow, `[2368]` twice; `cf8dc422`'s `GUIDs`
   * says 308 and 310 follow. Read to the count, the line after is not the next
   * field; read by the lines, every one of the game's text resources ends on
   * its last line. The index in the brackets is not checked.
   */
  array<T>(depth: number, name: string, element: (index: number, value: string) => T): T[] {
    this.int(depth, name);
    const out: T[] = [];
    for (let line = this.lines[this.at]; line?.depth === depth + 1 && /^\[\d+\]$/.test(line.name); line = this.lines[this.at]) {
      this.at += 1;
      out.push(element(out.length, line.value));
    }
    return out;
  }

  /** An array of integers, each on its own `[i]` line. */
  intArray(depth: number, name: string): number[] {
    return this.array(depth, name, (i, value) => {
      if (!/^-?\d+$/.test(value)) throw new SerializerError(`${this.magic}: element ${i} of ${name} is "${value}"`);
      return Number(value);
    });
  }

  /**
   * The rest of the file as fields at `depth`, with no schema: a field whose
   * next line is `[0]` one level deeper is an array, and its count must be the
   * number of elements that follow; any other deeper line opens a struct's own
   * fields. Throws on a line more than one level deeper than the one above it,
   * so a file read whole by this has its indentation and its counts consistent.
   */
  tree(depth = 0): TextField[] {
    const fields: TextField[] = [];
    while (this.lines[this.at] && this.lines[this.at].depth >= depth) {
      const line = this.lines[this.at];
      if (line.depth > depth) {
        throw new SerializerError(`${this.magic} line ${line.number}: "${line.name}" at depth ${line.depth}, below no array`);
      }
      this.at += 1;
      const next = this.lines[this.at];
      if (!next || next.depth !== depth + 1) {
        fields.push({ name: line.name, value: line.value });
        continue;
      }
      if (next.name !== '[0]') {
        fields.push({ name: line.name, value: line.value, fields: this.tree(depth + 1) });
        continue;
      }
      const count = Number(line.value);
      const elements: TextElement[] = [];
      for (let i = 0; this.lines[this.at]?.depth === depth + 1; i += 1) {
        const value = this.raw(depth + 1, `[${i}]`);
        elements.push({ value, fields: this.tree(depth + 2) });
      }
      if (elements.length !== count) {
        throw new SerializerError(`${this.magic} line ${line.number}: "${line.name}" says ${line.value}, ${elements.length} follow`);
      }
      fields.push({ name: line.name, value: line.value, elements });
    }
    return fields;
  }

  /** Throws unless every line was read. */
  end(): void {
    const line = this.lines[this.at];
    if (line) throw new SerializerError(`${this.magic} line ${line.number}: "${line.name}" left unread`);
  }
}

/** Any text resource, read whole without its schema: its magic and its fields. */
export function readTextTree(bytes: Uint8Array): { readonly magic: string; readonly fields: readonly TextField[] } {
  const t = new TextResource(bytes);
  const fields = t.tree();
  t.end();
  return { magic: t.magic, fields };
}
