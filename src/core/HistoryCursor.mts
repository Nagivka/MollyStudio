export interface UndoableCommand {
    execute(): unknown;
    undo(): unknown;
}
/** Move a history cursor only after the operation succeeds; retain a failed step for retry. */
export function applyHistoryStep<T extends UndoableCommand>(from: T[], to: T[], undo: boolean, onError: (error: unknown) => void): boolean {
    const command = from.pop();
    if (!command)
        return false;
    try {
        if (undo)
            command.undo();
        else
            command.execute();
    }
    catch (error) {
        from.push(command);
        onError(error);
        return false;
    }
    to.push(command);
    return true;
}
