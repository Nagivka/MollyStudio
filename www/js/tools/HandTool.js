import Tool from './Tool.js';

export default class HandTool extends Tool {
    constructor(bus, layerManager, history) {
        super(bus, layerManager, history);
    }

    onPointerDown() {}
    onPointerMove() {}
    onPointerUp() {}
    deactivate() {}
}
