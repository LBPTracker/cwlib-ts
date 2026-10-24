/** `REF`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';

/** `PRef`: a Thing standing in for a plan that has not been instanced. */
export function readRef(s: Serializer): void {
  const { version } = s.revision;
  s.resource(true); // plan, a GlobalThingDescriptor below 0x160
  s.i32(); // oldLifetime
  if (version >= 0x1c9) s.i32(); // oldAliveFrames
  // Both of these went away at 0x321, which is why LBP3 never sees them.
  if (version < 0x321) s.bool(); // childrenSelectable
  if (version >= 0x13d && version < 0x321) s.bool(); // stripChildren
}
