const apiUrl = '/api/users';
const userGrid = document.getElementById('userGrid');
const errorDiv = document.getElementById('error');
const deleteAllBtn = document.getElementById('deleteAllBtn');
const loadingDiv = document.getElementById('loading');
const paginationDiv = document.getElementById('pagination');
const filterInput = document.getElementById('filterInput');
const headers = document.querySelectorAll('th[data-sort]');

let currentPage = 1;
const limit = 50;
let sortField = 'name';
let sortDirection = 'asc';
let searchQuery = '';
let debounceTimeout;

function showLoading() {
  loadingDiv.style.display = 'block';
}

function hideLoading() {
  loadingDiv.style.display = 'none';
}

function displayError(message) {
  errorDiv.innerHTML = message.replace(/, /g, '<br>');
  errorDiv.classList.add('show');
}

function clearError() {
  errorDiv.innerHTML = '';
  errorDiv.classList.remove('show');
}

function updateSortIndicators() {
  headers.forEach(header => {
    header.classList.remove('sort-asc', 'sort-desc');
    if (header.dataset.sort === sortField) {
      header.classList.add(`sort-${sortDirection}`);
    }
  });
}

async function fetchUsers(page = 1) {
  showLoading();
  try {
    const queryParams = new URLSearchParams({
      page,
      limit,
      sortBy: sortField,
      sortDir: sortDirection,
      search: searchQuery
    });
    const response = await fetch(`${apiUrl}?${queryParams}`);
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || `Failed to fetch users (Status: ${response.status})`);
    }

    const data = await response.json();
    if (!data.users || !Array.isArray(data.users)) {
      throw new Error('Invalid response: users array not found');
    }

    let users = data.users;
    if (searchQuery) {
      users = users.filter(user =>
        (user.name || '').toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    currentPage = data.page || 1;
    userGrid.innerHTML = '';

    users.forEach(user => {
      const row = document.createElement('tr');
      row.dataset.id = user._id;
      row.innerHTML = `
        <td data-field="name" contenteditable="true">${user.name || ''}</td>
        <td data-field="email" contenteditable="true">${user.email || ''}</td>
        <td data-field="dob" contenteditable="true">${user.dob ? new Date(user.dob).toLocaleDateString() : ''}</td>
        <td data-field="contact" contenteditable="true">${user.contact || ''}</td>
        <td data-field="state" contenteditable="true">${user.state || ''}</td>
        <td data-field="country" contenteditable="true">${user.country || ''}</td>
        <td class="actions-cell">
          <button class="btn btn-primary btn-small" onclick="window.location.href='/edit/${user._id}'">✏️ Edit</button>
          <button class="btn btn-danger btn-small" onclick="deleteUser('${user._id}')">🗑️ Delete</button>
        </td>
      `;
      userGrid.appendChild(row);
    });

    document.querySelectorAll('td[contenteditable]').forEach(cell => {
      cell.addEventListener('blur', async (e) => {
        const userId = e.target.closest('tr').dataset.id;
        const field = e.target.dataset.field;
        const value = e.target.textContent.trim();
        if (value !== e.target.dataset.original) {
          await updateUser(userId, { [field]: field === 'dob' ? new Date(value).toISOString() : value });
        }
      });
      cell.addEventListener('focus', (e) => {
        e.target.dataset.original = e.target.textContent.trim();
      });
      cell.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.target.blur();
        }
      });
    });

    updatePagination(Math.ceil(users.length / limit) || 1);
    console.log(`Fetched ${users.length} users for search: "${searchQuery}"`);
    return users;
  } catch (err) {
    console.error('Fetch Users Error:', err);
    displayError(err.message);
    return [];
  } finally {
    hideLoading();
  }
}

function updatePagination(totalPages) {
  paginationDiv.innerHTML = '';
  if (totalPages > 1) {
    if (currentPage > 1) {
      const prevBtn = document.createElement('button');
      prevBtn.className = 'btn btn-primary';
      prevBtn.textContent = '« Previous';
      prevBtn.onclick = () => fetchUsers(currentPage - 1);
      paginationDiv.appendChild(prevBtn);
    }

    const pageInfo = document.createElement('span');
    pageInfo.textContent = ` Page ${currentPage} of ${totalPages} `;
    paginationDiv.appendChild(pageInfo);

    if (currentPage < totalPages) {
      const nextBtn = document.createElement('button');
      nextBtn.className = 'btn btn-primary';
      nextBtn.textContent = 'Next »';
      nextBtn.onclick = () => fetchUsers(currentPage + 1);
      paginationDiv.appendChild(nextBtn);
    }
  }
}

async function updateUser(id, updates) {
  showLoading();
  try {
    if (updates.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updates.email)) {
      throw new Error('Invalid email format');
    }
    if (updates.dob && isNaN(new Date(updates.dob).getTime())) {
      throw new Error('Invalid date of birth');
    }
    if (updates.contact && !/^[0-9]{10}$/.test(updates.contact)) {
      throw new Error('Contact must be a valid 10-digit number');
    }
    if (updates.state && (updates.state.length < 2 || updates.state.length > 50)) {
      throw new Error('State must be between 2 and 50 characters');
    }
    if (updates.country && (updates.country.length < 2 || updates.country.length > 50)) {
      throw new Error('Country must be between 2 and 50 characters');
    }
    const response = await fetch(`${apiUrl}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || `Failed to update user (Status: ${response.status})`);
    }
  } catch (err) {
    console.error('Update User Error:', err);
    displayError(err.message);
    fetchUsers(currentPage);
  } finally {
    hideLoading();
  }
}

// ✅ Make deleteUser globally accessible
window.deleteUser = async function(id) {
  if (!confirm('Are you sure you want to delete this user?')) return;
  showLoading();
  try {
    const response = await fetch(`${apiUrl}/${id}`, { method: 'DELETE' });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || `Failed to delete user (Status: ${response.status})`);
    }
    fetchUsers(currentPage);
  } catch (err) {
    console.error('Delete User Error:', err);
    displayError(err.message);
  } finally {
    hideLoading();
  }
};

deleteAllBtn.addEventListener('click', async () => {
  if (!confirm('Are you sure you want to delete all users?')) return;
  showLoading();
  try {
    const response = await fetch(apiUrl, { method: 'DELETE' });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || `Failed to delete all users (Status: ${response.status})`);
    }
    fetchUsers(1);
  } catch (err) {
    console.error('Delete All Users Error:', err);
    displayError(err.message);
  } finally {
    hideLoading();
  }
});

function refreshData() {
  searchQuery = '';
  filterInput.value = '';
  clearError();
  fetchUsers(currentPage);
}

// ✅ Export function for JSON, globally accessible
window.exportJson = function() {
  console.log('Export JSON functionality to be implemented');
  displayError('Export JSON is not yet implemented. Please contact the administrator.');
};

function debounce(func, wait) {
  return function (...args) {
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => func.apply(this, args), wait);
  };
}

async function checkAndShowForm() {
  clearError();
  const users = await fetchUsers(currentPage);
  if (users.length === 0 && searchQuery) {
    displayError('No users found for the given name.');
  } else {
    clearError();
  }
}

filterInput.addEventListener('input', debounce((e) => {
  searchQuery = e.target.value.trim();
  currentPage = 1;
  checkAndShowForm();
}, 300));

headers.forEach(header => {
  header.addEventListener('click', () => {
    const field = header.dataset.sort;
    if (sortField === field) {
      sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      sortField = field;
      sortDirection = 'asc';
    }
    updateSortIndicators();
    fetchUsers(currentPage);
  });
});

userGrid.addEventListener('keydown', (e) => {
  const activeElement = document.activeElement;
  if (!activeElement.hasAttribute('contenteditable')) return;

  const row = activeElement.closest('tr');
  const cells = Array.from(row.querySelectorAll('td[contenteditable]'));
  const cellIndex = cells.indexOf(activeElement);
  const rows = Array.from(userGrid.querySelectorAll('tr'));

  let nextCell = null;
  if (e.key === 'ArrowRight' && cellIndex < cells.length - 1) {
    nextCell = cells[cellIndex + 1];
  } else if (e.key === 'ArrowLeft' && cellIndex > 0) {
    nextCell = cells[cellIndex - 1];
  } else if (e.key === 'ArrowDown' && rows.indexOf(row) < rows.length - 1) {
    nextCell = rows[rows.indexOf(row) + 1].querySelectorAll('td[contenteditable]')[cellIndex];
  } else if (e.key === 'ArrowUp' && rows.indexOf(row) > 0) {
    nextCell = rows[rows.indexOf(row) - 1].querySelectorAll('td[contenteditable]')[cellIndex];
  }

  if (nextCell) {
    e.preventDefault();
    nextCell.focus();
  }
});

// Initial load
fetchUsers();