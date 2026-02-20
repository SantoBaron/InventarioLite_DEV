const storageKey = 'agq-lite-inventory';

const form = document.getElementById('inventory-form');
const nameInput = document.getElementById('product-name');
const qtyInput = document.getElementById('product-qty');
const listElement = document.getElementById('inventory-list');
const emptyStateElement = document.getElementById('empty-state');

function getInventory() {
  const rawValue = localStorage.getItem(storageKey);
  if (!rawValue) {
    return [];
  }

  try {
    const data = JSON.parse(rawValue);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveInventory(items) {
  localStorage.setItem(storageKey, JSON.stringify(items));
}

function renderInventory() {
  const items = getInventory();
  listElement.innerHTML = '';

  if (!items.length) {
    emptyStateElement.hidden = false;
    return;
  }

  emptyStateElement.hidden = true;

  items.forEach((item) => {
    const listItem = document.createElement('li');
    listItem.className = 'inventory-item';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'item-name';
    nameSpan.textContent = item.name;

    const qtySpan = document.createElement('span');
    qtySpan.className = 'item-qty';
    qtySpan.textContent = `Cantidad: ${item.quantity}`;

    listItem.append(nameSpan, qtySpan);
    listElement.appendChild(listItem);
  });
}

function addInventoryItem(name, quantity) {
  const items = getInventory();
  items.push({
    name,
    quantity,
    createdAt: Date.now(),
  });
  saveInventory(items);
}

form.addEventListener('submit', (event) => {
  event.preventDefault();

  const name = nameInput.value.trim();
  const quantity = Number.parseInt(qtyInput.value, 10);

  if (!name || Number.isNaN(quantity) || quantity <= 0) {
    return;
  }

  addInventoryItem(name, quantity);
  form.reset();
  nameInput.focus();
  renderInventory();
});

renderInventory();
