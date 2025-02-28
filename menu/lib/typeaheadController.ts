/**
 * @license
 * Copyright 2023 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {MenuItem} from './shared.js';

/**
 * The options that are passed to the typeahead controller.
 */
export interface TypeaheadControllerProperties {
  /**
   * A function that returns an array of menu items to be searched.
   * @return An array of menu items to be searched by typing.
   */
  getItems: () => MenuItem[];
  /**
   * The maximum time between each keystroke to keep the current type buffer
   * alive.
   */
  typeaheadBufferTime: number;
  /**
   * Whether or not the typeahead should listen for keystrokes or not.
   */
  active: boolean;
}

/**
 * Data structure tuple that helps with indexing.
 *
 * [index, item, normalized header text]
 */
type TypeaheadRecord = [number, MenuItem, string];
// Indicies to access the TypeaheadRecord tuple
const TYPEAHEAD_INDEX = 0;
const TYPEAHEAD_ITEM = 1;
const TYPEAHEAD_TEXT = 2;

/**
 * This controller listens to `keydown` events and searches the header text of
 * an array of `MenuItem`s with the corresponding entered keys within the buffer
 * time and activates the item.
 *
 * @example
 * ```ts
 * const typeaheadController = new TypeaheadController(() => ({
 *   typeaheadBufferTime: 50,
 *   getItems: () => Array.from(document.querySelectorAll('md-menu-item'))
 * }));
 * html`
 *   <div
 *       @keydown=${typeaheadController.onKeydown}
 *       tabindex="0"
 *       class="activeItemText">
 *     <!-- focusable element that will receive keydown events -->
 *     Apple
 *   </div>
 *   <div>
 *     <md-menu-item active header="Apple"></md-menu-item>
 *     <md-menu-item header="Apricot"></md-menu-item>
 *     <md-menu-item header="Banana"></md-menu-item>
 *     <md-menu-item header="Olive"></md-menu-item>
 *     <md-menu-item header="Orange"></md-menu-item>
 *   </div>
 * `;
 * ```
 */
export class TypeaheadController {
  /**
   * Array of tuples that helps with indexing.
   */
  protected typeaheadRecords: TypeaheadRecord[] = [];
  /**
   * Currently-typed text since last buffer timeout
   */
  protected typaheadBuffer = '';
  /**
   * The timeout id from the current buffer's setTimeout
   */
  protected cancelTypeaheadTimeout = 0;
  /**
   * If we are currently "typing"
   */
  protected isTypingAhead = false;
  /**
   * The record of the last active item.
   */
  protected lastActiveRecord: TypeaheadRecord|null = null;

  /**
   * @param getProperties A function that returns the options of the typeahead
   * controller:
   *
   * {
   *   getItems: A function that returns an array of menu items to be searched.
   *   typeaheadBufferTime: The maximum time between each keystroke to keep the
   *       current type buffer alive.
   * }
   */
  constructor(
      protected getProperties: () => TypeaheadControllerProperties,
  ) {}

  protected get items() {
    return this.getProperties().getItems();
  }

  protected get active() {
    return this.getProperties().active;
  }

  /**
   * Apply this listener to the element that will receive `keydown` events that
   * should trigger this controller.
   *
   * @param e The native browser `KeyboardEvent` from the `keydown` event.
   */
  readonly onKeydown = (e: KeyboardEvent) => {
    if (this.isTypingAhead) {
      this.typeahead(e);
    } else {
      this.beginTypeahead(e);
    }
  };

  /**
   * Sets up typingahead
   */
  protected beginTypeahead(e: KeyboardEvent) {
    if (!this.active) {
      return;
    }

    // We don't want to typeahead if the _beginning_ of the typeahead is a menu
    // navigation, or a selection. We will handle "Space" only if it's in the
    // middle of a typeahead
    if (e.code === 'Space' || e.code === 'Enter' ||
        e.code.startsWith('Arrow') || e.code === 'Escape') {
      return;
    }

    this.isTypingAhead = true;
    // Generates the record array data structure which is the index, the element
    // and a normalized header.
    this.typeaheadRecords = this.items.map(
        (el, index) => [index, el, el.headline.trim().toLowerCase()]);
    this.lastActiveRecord =
        this.typeaheadRecords.find(record => record[TYPEAHEAD_ITEM].active) ??
        null;
    if (this.lastActiveRecord) {
      this.lastActiveRecord[TYPEAHEAD_ITEM].active = false;
    }
    this.typeahead(e);
  }

  /**
   * Performs the typeahead. Based on the normalized items and the current text
   * buffer, finds the _next_ item with matching text and activates it.
   *
   * @example
   *
   * items: Apple, Banana, Olive, Orange, Cucumber
   * buffer: ''
   * user types: o
   *
   * activates Olive
   *
   * @example
   *
   * items: Apple, Banana, Olive (active), Orange, Cucumber
   * buffer: 'o'
   * user types: l
   *
   * activates Olive
   *
   * @example
   *
   * items: Apple, Banana, Olive (active), Orange, Cucumber
   * buffer: ''
   * user types: o
   *
   * activates Orange
   *
   * @example
   *
   * items: Apple, Banana, Olive, Orange (active), Cucumber
   * buffer: ''
   * user types: o
   *
   * activates Olive
   */
  protected typeahead(e: KeyboardEvent) {
    clearTimeout(this.cancelTypeaheadTimeout);
    // Stop typingahead if one of the navigation or selection keys (except for
    // Space) are pressed
    if (e.code === 'Enter' || e.code.startsWith('Arrow') ||
        e.code === 'Escape') {
      this.endTypeahead();
      if (this.lastActiveRecord) {
        this.lastActiveRecord[TYPEAHEAD_ITEM].active = false;
      }
      return;
    }

    // If Space is pressed, prevent it from selecting and closing the menu
    if (e.code === 'Space') {
      e.stopPropagation();
      e.preventDefault();
    }

    // Start up a new keystroke buffer timeout
    this.cancelTypeaheadTimeout =
        setTimeout(this.endTypeahead, this.getProperties().typeaheadBufferTime);

    this.typaheadBuffer += e.key.toLowerCase();

    const lastActiveIndex =
        this.lastActiveRecord ? this.lastActiveRecord[TYPEAHEAD_INDEX] : -1;
    const numRecords = this.typeaheadRecords.length;

    /**
     * Sorting function that will resort the items starting with the given index
     *
     * @example
     *
     * this.typeaheadRecords =
     * 0: [0, <reference>, 'apple']
     * 1: [1, <reference>, 'apricot']
     * 2: [2, <reference>, 'banana']
     * 3: [3, <reference>, 'olive'] <-- lastActiveIndex
     * 4: [4, <reference>, 'orange']
     * 5: [5, <reference>, 'strawberry']
     *
     * this.typeaheadRecords.sort((a,b) => rebaseIndexOnActive(a)
     *                                       - rebaseIndexOnActive(b)) ===
     * 0: [3, <reference>, 'olive'] <-- lastActiveIndex
     * 1: [4, <reference>, 'orange']
     * 2: [5, <reference>, 'strawberry']
     * 3: [0, <reference>, 'apple']
     * 4: [1, <reference>, 'apricot']
     * 5: [2, <reference>, 'banana']
     */
    const rebaseIndexOnActive = (record: TypeaheadRecord) => {
      return (record[TYPEAHEAD_INDEX] + numRecords - lastActiveIndex) %
          numRecords;
    };

    // records filtered and sorted / rebased around the last active index
    const matchingRecords =
        this.typeaheadRecords
            .filter(
                record => !record[TYPEAHEAD_ITEM].disabled &&
                    record[TYPEAHEAD_TEXT].startsWith(this.typaheadBuffer))
            .sort((a, b) => rebaseIndexOnActive(a) - rebaseIndexOnActive(b));

    // Just leave if there's nothing that matches. Native select will just
    // choose the first thing that starts with the next letter in the alphabet
    // but that's out of scope and hard to localize
    if (matchingRecords.length === 0) {
      clearTimeout(this.cancelTypeaheadTimeout);
      if (this.lastActiveRecord) {
        this.lastActiveRecord[TYPEAHEAD_ITEM].active = false;
      }
      this.endTypeahead();
      return;
    }

    const isNewQuery = this.typaheadBuffer.length === 1;
    let nextRecord: TypeaheadRecord;

    // This is likely the case that someone is trying to "tab" through different
    // entries that start with the same letter
    if (this.lastActiveRecord === matchingRecords[0] && isNewQuery) {
      nextRecord = matchingRecords[1] ?? matchingRecords[0];
    } else {
      nextRecord = matchingRecords[0];
    }

    if (this.lastActiveRecord) {
      this.lastActiveRecord[TYPEAHEAD_ITEM].active = false;
    }

    this.lastActiveRecord = nextRecord;
    nextRecord[TYPEAHEAD_ITEM].active = true;
    return;
  }

  /**
   * Ends the current typeahead and clears the buffer.
   */
  protected endTypeahead = () => {
    this.isTypingAhead = false;
    this.typaheadBuffer = '';
    this.typeaheadRecords = [];
  };
}
