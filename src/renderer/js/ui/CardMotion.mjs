/** Damped spring, integrated in small steps so pointer frequency does not set speed. */
export function advanceCardSpring(state,target,seconds){
    const duration=Math.max(0,Math.min(1/15,seconds)),steps=Math.max(1,Math.ceil(duration*120)),dt=duration/steps;
    for(let step=0;step<steps;step++)for(let axis=0;axis<state.position.length;axis++){
        state.velocity[axis]+=((target[axis]-state.position[axis])*256-state.velocity[axis]*23)*dt;
        state.position[axis]+=state.velocity[axis]*dt;
    }
    return state.position.every((value,axis)=>Math.abs(value-target[axis])<.015&&Math.abs(state.velocity[axis])<.03);
}
