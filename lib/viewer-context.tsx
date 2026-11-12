'use client';
import { createContext, useContext } from 'react';

// Whether the person looking at a NEXT page is signed in. Set once by the
// NEXT layout, read by small interactive pieces (Watch, Back, Claim) deep in
// the tree so they can send a signed-out visitor to sign up instead of
// calling an API that would refuse them.
type Viewer = { guest: boolean };

const ViewerContext = createContext<Viewer>({ guest: false });

export function ViewerProvider({ guest, children }: { guest: boolean; children: React.ReactNode }) {
  return <ViewerContext.Provider value={{ guest }}>{children}</ViewerContext.Provider>;
}

export function useViewer(): Viewer {
  return useContext(ViewerContext);
}
