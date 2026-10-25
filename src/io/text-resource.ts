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

  /** A field's value as written: a quoted string keeps its quotes. */
  raw(depth: number, name: string): string {
    return this.next(depth, name).value;
  }

  int(depth: number, name: string): number {
    const { value, number } = this.next(depth, name);
    if (!/^-?\d+$/.test(value)) throw new SerializerError(`${this.magic} line ${number}: "${value}" is no integer`);
    return Number(value);
  }

  /** A quoted string, unquoted; nothing in the game's files escapes a quote. */
  string(depth: number, name: string): string {
    const { value, number } = this.next(depth, name);
    if (!/^".*"$/.test(value)) throw new SerializerError(`${this.magic} line ${number}: ${value} is no string`);
    return value.slice(1, -1);
  }

  /** An array: its count line, then each `[i]` read by `element` at `depth + 1`. */
  array<T>(depth: number, name: string, element: (index: number, value: string) => T): T[] {
    const count = this.int(depth, name);
    const out: T[] = [];
    for (let i = 0; i < count; i += 1) out.push(element(i, this.raw(depth + 1, `[${i}]`)));
    return out;
  }

  /** An array of integers, each on its own `[i]` line. */
  intArray(depth: number, name: string): number[] {
    return this.array(depth, name, (i, value) => {
      if (!/^-?\d+$/.test(value)) throw new SerializerError(`${this.magic}: element ${i} of ${name} is "${value}"`);
      return Number(value);
    });
  }

  /** Throws unless every line was read. */
  end(): void {
    const line = this.lines[this.at];
    if (line) throw new SerializerError(`${this.magic} line ${line.number}: "${line.name}" left unread`);
  }
}
