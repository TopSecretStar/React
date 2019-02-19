// @flow

import React, {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { TreeContext } from './TreeContext';
import { BridgeContext, StoreContext } from './context';
import Button from './Button';
import ButtonIcon from './ButtonIcon';
import HooksTree from './HooksTree';
import InspectedElementTree from './InspectedElementTree';
import { hydrate } from 'src/hydration';
import styles from './SelectedElement.css';
import { ElementTypeClass, ElementTypeFunction } from '../types';

import type { InspectedElement } from '../types';
import type { DehydratedData, Element } from 'src/devtools/types';

export type Props = {||};

export default function SelectedElement(_: Props) {
  const { selectedElementID } = useContext(TreeContext);
  const bridge = useContext(BridgeContext);
  const store = useContext(StoreContext);
  const element =
    selectedElementID !== null ? store.getElementByID(selectedElementID) : null;

  const inspectedElement = useInspectedElement(selectedElementID);

  const handleClick = useCallback(() => {
    if (element !== null && selectedElementID !== null) {
      const rendererID =
        store.getRendererIDForElement(selectedElementID) || null;
      if (rendererID !== null) {
        bridge.send('highlightElementInDOM', {
          displayName: element.displayName,
          id: selectedElementID,
          rendererID,
        });
      }
    }
  }, [bridge, element, selectedElementID, store]);

  // TODO Make "view source" button work

  if (element === null) {
    return (
      <div className={styles.SelectedElement}>
        <div className={styles.TitleRow} />
      </div>
    );
  }

  const source = inspectedElement ? inspectedElement.source : null;

  return (
    <div className={styles.SelectedElement}>
      <div className={styles.TitleRow}>
        <div className={styles.SelectedComponentName}>
          <div className={styles.Component} title={element.displayName}>
            {element.displayName}
          </div>
        </div>

        <Button
          className={styles.IconButton}
          onClick={handleClick}
          title="Highlight this element in the page"
        >
          <ButtonIcon type="view-dom" />
        </Button>
        {source !== null && (
          <Button
            className={styles.IconButton}
            title="View source for this element"
          >
            <ButtonIcon type="view-source" />
          </Button>
        )}
      </div>

      {inspectedElement === null && (
        <div className={styles.Loading}>Loading...</div>
      )}

      {inspectedElement !== null && (
        <InspectedElementView
          element={element}
          inspectedElement={inspectedElement}
        />
      )}
    </div>
  );
}

type InspectedElementViewProps = {|
  element: Element,
  inspectedElement: InspectedElement,
|};

function InspectedElementView({
  element,
  inspectedElement,
}: InspectedElementViewProps) {
  const { id, type } = element;
  const { context, hooks, owners, props, state } = inspectedElement;

  const { ownerStack } = useContext(TreeContext);
  const bridge = useContext(BridgeContext);
  const store = useContext(StoreContext);

  let overrideContextFn = null;
  let overridePropsFn = null;
  let overrideStateFn = null;
  if (type === ElementTypeClass) {
    overrideContextFn = (path: Array<string | number>, value: any) => {
      const rendererID = store.getRendererIDForElement(id);
      bridge.send('overrideContext', { id, path, rendererID, value });
    };
    overridePropsFn = (path: Array<string | number>, value: any) => {
      const rendererID = store.getRendererIDForElement(id);
      bridge.send('overrideProps', { id, path, rendererID, value });
    };
    overrideStateFn = (path: Array<string | number>, value: any) => {
      const rendererID = store.getRendererIDForElement(id);
      bridge.send('overrideState', { id, path, rendererID, value });
    };
  } else if (type === ElementTypeFunction) {
    // TODO Only enable this if renderer.canEditFunctionProps is true!
    overridePropsFn = (path: Array<string | number>, value: any) => {
      const rendererID = store.getRendererIDForElement(id);
      bridge.send('overrideProps', { id, path, rendererID, value });
    };
  }

  return (
    <div className={styles.InspectedElement}>
      <InspectedElementTree
        label="props"
        data={props}
        overrideValueFn={overridePropsFn}
        showWhenEmpty
      />
      <InspectedElementTree
        label="state"
        data={state}
        overrideValueFn={overrideStateFn}
      />
      <HooksTree hooksTree={hooks} />
      <InspectedElementTree
        label="context"
        data={context}
        overrideValueFn={overrideContextFn}
      />

      {ownerStack.length === 0 && owners !== null && owners.length > 0 && (
        <div className={styles.Owners}>
          <div>owner stack</div>
          {owners.map(owner => (
            <OwnerView
              key={owner.id}
              displayName={owner.displayName}
              id={owner.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function OwnerView({ displayName, id }: { displayName: string, id: number }) {
  const { selectElementByID } = useContext(TreeContext);

  const handleClick = useCallback(() => selectElementByID(id), [
    id,
    selectElementByID,
  ]);

  return (
    <div
      key={id}
      className={styles.Owner}
      onClick={handleClick}
      title={displayName}
    >
      {displayName}
    </div>
  );
}

function hydrateHelper(dehydratedData: DehydratedData | null): Object | null {
  if (dehydratedData !== null) {
    return hydrate(dehydratedData.data, dehydratedData.cleaned);
  } else {
    return null;
  }
}

function useInspectedElement(id: number | null): InspectedElement | null {
  const idRef = useRef(id);
  const bridge = useContext(BridgeContext);
  const store = useContext(StoreContext);

  const [inspectedElement, setInspectedElement] = useState(null);

  useEffect(() => {
    // Track the current selected element ID.
    // We ignore any backend updates about previously selected elements.
    idRef.current = id;

    // Hide previous/stale insepected element to avoid temporarily showing the wrong values.
    setInspectedElement(null);

    // A null id indicates that there's nothing currently selected in the tree.
    if (id === null) {
      return () => {};
    }

    const rendererID = store.getRendererIDForElement(id) || null;

    // Update the $r variable.
    bridge.send('selectElement', { id, rendererID });

    // Update props, state, and context in the side panel.
    const sendBridgeRequest = () => {
      bridge.send('inspectElement', { id, rendererID });
    };

    let timeoutID = null;

    const onInspectedElement = (inspectedElement: InspectedElement) => {
      if (!inspectedElement || inspectedElement.id !== idRef.current) {
        // Ignore bridge updates about previously selected elements.
        return;
      }

      if (inspectedElement !== null) {
        inspectedElement.context = hydrateHelper(inspectedElement.context);
        inspectedElement.hooks = hydrateHelper(inspectedElement.hooks);
        inspectedElement.props = hydrateHelper(inspectedElement.props);
        inspectedElement.state = hydrateHelper(inspectedElement.state);
      }

      setInspectedElement(inspectedElement);

      // Ask for an update in a second...
      timeoutID = setTimeout(sendBridgeRequest, 1000);
    };

    bridge.addListener('inspectedElement', onInspectedElement);

    sendBridgeRequest();

    return () => {
      if (timeoutID !== null) {
        clearTimeout(timeoutID);
      }

      bridge.removeListener('inspectedElement', onInspectedElement);
    };
  }, [bridge, id, idRef, store]);

  return inspectedElement;
}
