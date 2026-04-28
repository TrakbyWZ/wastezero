# Quick Start: Create Customer Sequences

After customer setup is complete, create a sequence definition for that customer.

---

## Process

1. Open **Customer Sequences**.
2. Select or filter to the target customer.
3. Create a new sequence.
4. Enter sequence values carefully.
5. Save and verify the sequence appears in the list.

---

## Screenshots

Customer Sequences list page:

![Customer sequences page list view](/docs-images/customer-sequence-page.png)

Create sequence form:

![Create new customer sequence form](/docs-images/customer-sequence-new-sequence.png)

---

## Sequence uniqueness factors

A valid sequence is unique based on a combination of fields. Operators should verify:

- **Customer**: Sequence belongs to a specific customer.
- **Prefix / Code**: Identifies the sequence family.
- **Format / Pattern**: Number formatting rules.
- **Range or Start/End** (when applicable): Valid numeric bounds.
- **Offset / Next Start** (when applicable): Current generation position.

> **Important:** Avoid duplicate sequence definitions with the same customer plus prefix and format/range combination.

---

## Operator checklist

- Correct customer selected.
- Sequence fields validated for uniqueness.
- Sequence saved and visible.

---

## Next step

Go to [Create Batches and Export CSV](./quick-start-batches.md).
