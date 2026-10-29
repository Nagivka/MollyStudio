/** Move a history cursor only after the operation succeeds; retain a failed step for retry. */
export function applyHistoryStep(from, to, undo, onError) {
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
