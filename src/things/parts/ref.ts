/** `REF`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, type ResourceRef } from '../../io/serializer.ts';

/** `PRef`: a Thing standing in for a plan that has not been instanced. */
/** `PRef`, kept: the plan this Thing is a placed copy of. */
export interface RefPart {
  readonly plan?: ResourceRef;
  readonly oldLifetime: number;
  readonly oldAliveFrames: number;
  readonly childrenSelectable?: boolean;
  readonly stripChildren?: boolean;
}

export function readRef(s: Serializer): RefPart {
  const { version } = s.revision;
  let childrenSelectable: boolean | undefined;
  let stripChildren: boolean | undefined;
  const plan = s.resource(true); // a GlobalThingDescriptor below 0x160
  const oldLifetime = s.i32();
  const oldAliveFrames = version >= 0x1c9 ? s.i32() : 0;
  // Both of these went away at 0x321, which is why LBP3 never sees them.
  if (version < 0x321) childrenSelectable = s.bool();
  if (version >= 0x13d && version < 0x321) stripChildren = s.bool();
  return { plan, oldLifetime, oldAliveFrames, childrenSelectable, stripChildren };
}
