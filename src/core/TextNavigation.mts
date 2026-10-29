export interface TextGlyph {
    start: number;
    end: number;
    x: number;
    advance: number;
}
export interface TextLine {
    start: number;
    end: number;
    offset: number;
    width: number;
    y: number;
    glyphs: TextGlyph[];
}
export interface TextLayout {
    text: string;
    boundaries: number[];
    lines: TextLine[];
    leading: number;
}
interface HistoryEntry<T> {
    before: T;
    after: T;
    group: string | null;
    time: number;
}
/** Shared canvas text navigation and session history, independent of rendering. */
const graphemes = new Intl.Segmenter('ru', { granularity: 'grapheme' });
const words = new Intl.Segmenter('ru', { granularity: 'word' });
export function normalizeText(value: unknown, maxLength = 4096) {
    let text = String(value ?? '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '');
    if (text.toWellFormed)
        text = text.toWellFormed();
    if (text.length <= maxLength)
        return text;
    let end = 0;
    for (const item of graphemes.segment(text)) {
        const next = item.index + item.segment.length;
        if (next > maxLength)
            break;
        end = next;
    }
    return text.slice(0, end);
}
export function snapIndex(layout: TextLayout, index: number, direction = 'nearest') {
    index = Math.max(0, Math.min(layout.text.length, Number(index) || 0));
    if (layout.boundaries.includes(index))
        return index;
    const next = layout.boundaries.find(boundary => boundary > index) ?? layout.text.length;
    const previous = layout.boundaries.findLast(boundary => boundary < index) ?? 0;
    return direction === 'previous' ? previous : direction === 'next' ? next : index - previous < next - index ? previous : next;
}
export function caretPosition(layout: TextLayout, index: number, preferredLine: number | null = null) {
    index = snapIndex(layout, index);
    let lineIndex = Math.max(0, layout.lines.findLastIndex(line => line.start <= index));
    const preferred = preferredLine === null ? null : layout.lines[preferredLine]!;
    if (preferred && preferredLine !== null && index >= preferred.start && index <= preferred.end)
        lineIndex = preferredLine;
    const line = layout.lines[lineIndex]!;
    const glyph = line.glyphs.find(item => index < item.end);
    return { x: line.offset + (glyph ? glyph.x : line.width), y: line.y, line: lineIndex, index };
}
export function hitCaret(layout: TextLayout, x: number, y: number, leading = layout.leading, forceLine: number | null = null) {
    const lineIndex = Math.max(0, Math.min(layout.lines.length - 1, forceLine === null ? layout.lines.findLastIndex(line => line.y <= y) : forceLine));
    const line = layout.lines[lineIndex]!;
    let position = line.start;
    for (const glyph of line.glyphs) {
        if (x < line.offset + glyph.x + glyph.advance / 2)
            return { index: glyph.start, line: lineIndex };
        position = glyph.end;
    }
    return { index: position, line: lineIndex };
}
export function glyphIndexAt(layout: TextLayout, x: number, y: number) {
    const hit = hitCaret(layout, x, y);
    const line = layout.lines[hit.line]!;
    const glyph = line.glyphs.find(item => x < line.offset + item.x + item.advance);
    return glyph?.start ?? Math.max(line.start, line.end - 1);
}
export function wordRange(text: string, index: number) {
    if (!text.length)
        return { start: 0, end: 0 };
    index = Math.max(0, Math.min(text.length - 1, index));
    const item = [...words.segment(text)].find(item => index >= item.index && index < item.index + item.segment.length);
    return item ? { start: item.index, end: item.index + item.segment.length } : { start: index, end: index + 1 };
}
export function paragraphRange(text: string, index: number) {
    index = Math.max(0, Math.min(text.length, index));
    const start = index ? text.lastIndexOf('\n', index - 1) + 1 : 0;
    const newline = text.indexOf('\n', index);
    return { start, end: newline < 0 ? text.length : newline + 1 };
}
export function moveHorizontal(layout: TextLayout, index: number, preferredLine: number | null, direction: number, byWord = false) {
    const caret = caretPosition(layout, index, preferredLine);
    if (byWord) {
        const starts = [...words.segment(layout.text)].filter(item => item.isWordLike).map(item => item.index);
        const target = direction < 0 ? starts.findLast(start => start < index) ?? 0
            : starts.find(start => start > index) ?? layout.text.length;
        return { index: target, line: null };
    }
    if (direction < 0 && caret.line > 0 && layout.lines[caret.line]!.start === index && layout.lines[caret.line - 1]!.end === index)
        return { index, line: caret.line - 1 };
    if (direction > 0 && caret.line < layout.lines.length - 1 && layout.lines[caret.line]!.end === index && layout.lines[caret.line + 1]!.start === index)
        return { index, line: caret.line + 1 };
    const target = direction < 0 ? layout.boundaries.findLast(boundary => boundary < index) ?? 0
        : layout.boundaries.find(boundary => boundary > index) ?? layout.text.length;
    return { index: target, line: caretPosition(layout, target, caret.line).line };
}
export function moveVertical(layout: TextLayout, index: number, preferredLine: number | null, direction: number, goalX: number | null = null) {
    const caret = caretPosition(layout, index, preferredLine);
    goalX ??= caret.x;
    if (direction < 0 && caret.line === 0)
        return { index: 0, line: 0, goalX };
    if (direction > 0 && caret.line === layout.lines.length - 1)
        return { index: layout.text.length, line: caret.line, goalX };
    return { ...hitCaret(layout, goalX, 0, layout.leading, caret.line + direction), goalX };
}
export class SnapshotHistory<T extends {
    data: unknown;
} = {
    data: unknown;
}> {
    limit: number;
    undoStack: HistoryEntry<T>[];
    redoStack: HistoryEntry<T>[];
    constructor(limit = 80) { this.limit = limit; this.undoStack = []; this.redoStack = []; }
    get canUndo() { return this.undoStack.length > 0; }
    get canRedo() { return this.redoStack.length > 0; }
    breakGroup() { const last = this.undoStack.at(-1); if (last)
        last.group = null; }
    clear() { this.undoStack = []; this.redoStack = []; }
    record(before: T, after: T, { group = null, time = Date.now() }: {
        group?: string | null;
        time?: number;
    } = {}) {
        if (JSON.stringify(before.data) === JSON.stringify(after.data))
            return false;
        const previous = this.undoStack.at(-1);
        const joins = group && previous?.group === group && time - previous.time < 800 &&
            JSON.stringify(previous.after) === JSON.stringify(before) && !this.redoStack.length;
        if (joins) {
            previous.after = structuredClone(after);
            previous.time = time;
        }
        else {
            this.undoStack.push({ before: structuredClone(before), after: structuredClone(after), group, time });
            if (this.undoStack.length > this.limit)
                this.undoStack.shift();
        }
        this.redoStack = [];
        return true;
    }
    undo() {
        const entry = this.undoStack.pop();
        if (!entry)
            return null;
        entry.group = null;
        this.redoStack.push(entry);
        return structuredClone(entry.before);
    }
    redo() {
        const entry = this.redoStack.pop();
        if (!entry)
            return null;
        entry.group = null;
        this.undoStack.push(entry);
        return structuredClone(entry.after);
    }
}
