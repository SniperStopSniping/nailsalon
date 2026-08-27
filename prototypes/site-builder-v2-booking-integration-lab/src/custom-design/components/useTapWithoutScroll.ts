import {
  useCallback,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import {
  cancelTapGesture,
  createTapGestureState,
  tapGestureShouldActivate,
  updateTapGestureForScroll,
  updateTapGestureState,
  type CustomDesignTapGestureState,
} from '../model/geometry';

type ActivePointer = {
  id: number;
  gesture: CustomDesignTapGestureState;
};

type TapWithoutScrollOptions<TElement extends HTMLElement> = {
  getScrollPosition?: () => { x: number; y: number };
  onActivate?: (event: ReactMouseEvent<TElement>) => void;
};

const readWindowScroll = (): { x: number; y: number } => ({
  x: window.scrollX,
  y: window.scrollY,
});

export function useTapWithoutScroll<TElement extends HTMLElement>({
  getScrollPosition = readWindowScroll,
  onActivate,
}: TapWithoutScrollOptions<TElement> = {}) {
  const pointerRef = useRef<ActivePointer | null>(null);
  const suppressNextPointerClickRef = useRef(false);

  const onPointerDown = useCallback((event: ReactPointerEvent<TElement>) => {
    if (
      event.isPrimary === false
      || (typeof event.button === 'number' && event.button !== 0)
    ) {
      return;
    }
    suppressNextPointerClickRef.current = false;
    pointerRef.current = {
      id: event.pointerId,
      gesture: createTapGestureState(
        { x: event.clientX, y: event.clientY },
        getScrollPosition(),
      ),
    };
  }, [getScrollPosition]);

  const onPointerMove = useCallback((event: ReactPointerEvent<TElement>) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) {
      return;
    }
    pointer.gesture = updateTapGestureState(
      pointer.gesture,
      { x: event.clientX, y: event.clientY },
    );
  }, []);

  const onPointerUp = useCallback((event: ReactPointerEvent<TElement>) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) {
      return;
    }
    const movedGesture = updateTapGestureState(
      pointer.gesture,
      { x: event.clientX, y: event.clientY },
    );
    const finalGesture = updateTapGestureForScroll(
      movedGesture,
      getScrollPosition(),
    );
    suppressNextPointerClickRef.current = !tapGestureShouldActivate(finalGesture);
    pointerRef.current = null;
  }, [getScrollPosition]);

  const onPointerCancel = useCallback((event: ReactPointerEvent<TElement>) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) {
      return;
    }
    suppressNextPointerClickRef.current = !tapGestureShouldActivate(
      cancelTapGesture(pointer.gesture),
    );
    pointerRef.current = null;
  }, []);

  const onClick = useCallback((event: ReactMouseEvent<TElement>) => {
    const cameFromPointer = event.detail > 0;
    if (cameFromPointer && suppressNextPointerClickRef.current) {
      event.preventDefault();
      event.stopPropagation();
      suppressNextPointerClickRef.current = false;
      return;
    }
    suppressNextPointerClickRef.current = false;
    onActivate?.(event);
  }, [onActivate]);

  return {
    onClick,
    onPointerCancel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}
