/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Yaoweilei. All rights reserved.
 *
 *  This software is proprietary and confidential.
 *  Unauthorized copying, distribution, modification, or use of this software,
 *  via any medium, is strictly prohibited without prior written permission.
 *--------------------------------------------------------------------------------------------*/

interface CategorySectionQuestion {
	id: string | number;
	[key: string]: unknown;
}

interface CategorySection {
	section_name?: string;
	section_title?: string;
	section_id?: number;
	questions?: CategorySectionQuestion[];
	[key: string]: unknown;
}

interface CategoryEntry {
	id: string;
	label: string;
	sectionIndexes: number[];
}

interface CategoryMenuItem {
	label: string;
	value: string;
}

interface CategoryNavigationExamViewer {
	currentExam?: {
		exam_info?: {
			sections?: CategorySection[];
		};
	} | null;
	getCategories: () => CategoryEntry[];
	stateManager: {
		updateNavigationState: (sectionIndex: number, questionIndex: number, categoryId?: string | null) => void;
	};
	audioManager: {
		stopAllAudio: () => void;
	};
}

/**
 * 分类导航管理器 - 负责分类下拉菜单和导航
 */
class CategoryNavigationManager {
	private readonly examViewer: CategoryNavigationExamViewer;

	constructor(examViewer: CategoryNavigationExamViewer) {
		this.examViewer = examViewer;
	}

	/**
	 * 初始化分类下拉菜单
	 */
	initCategoryDropdowns(): void {
		console.log('[CategoryNavigationManager] initCategoryDropdowns called');
		const categorySlots = document.querySelectorAll('.category-slot');
		const categories = this.examViewer.getCategories();
		console.log('[CategoryNavigationManager] Found category slots:', categorySlots.length);

		categorySlots.forEach((slot, index) => {
			slot.querySelectorAll('.category-multi-dropdown').forEach((node) => node.remove());
			const category = categories[index];
			(slot as HTMLElement).style.display = category ? '' : 'none';
			console.log(`[CategoryNavigationManager] Processing slot ${index} with category:`, category?.id);
			if (!category) {
				return;
			}

			const dropdown = document.createElement('div');
			dropdown.className = 'category-multi-dropdown';

			const label = document.createElement('div');
			label.className = 'category-dropdown-label';
			label.textContent = category.label;
			label.addEventListener('click', () => {
				this.toggleCategoryDropdown(dropdown);
			});

			const menu = document.createElement('div');
			menu.className = 'category-dropdown-menu';

			const menuItems = this.getCategoryMenuItems(category.id);
			console.log(`[CategoryNavigationManager] Menu items for ${category.id}:`, menuItems);
			menuItems.forEach((item) => {
				const menuItem = document.createElement('div');
				menuItem.className = 'category-menu-item';
				menuItem.textContent = item.label;
				menuItem.addEventListener('click', () => {
					this.selectCategoryItem(category.id, item.value);
					this.closeCategoryDropdown(dropdown);
				});
				menu.appendChild(menuItem);
			});

			dropdown.appendChild(label);
			dropdown.appendChild(menu);
			slot.appendChild(dropdown);
			console.log(`[CategoryNavigationManager] Dropdown created for slot ${index}`);
		});

		if (!document.__exam_category_click_registered) {
			document.addEventListener('click', (event) => {
				const target = event.target as HTMLElement | null;
				if (!target?.closest('.category-multi-dropdown')) {
					document.querySelectorAll('.category-multi-dropdown.open').forEach((dropdown) => {
						(dropdown as HTMLElement).classList.remove('open');
					});
				}
			});
			document.__exam_category_click_registered = true;
		}
	}

	/**
	 * 渲染分类导航
	 */
	renderCategoryNavigation(): void {
		const container = DOMUtils.safeGetElement('category-navigation', 'renderCategoryNavigation');
		if (!container || !this.examViewer.currentExam) {
			return;
		}

		DOMUtils.safeSetInnerHTML(container, '', 'renderCategoryNavigation-clear');

		const categories = this.examViewer.getCategories();

		categories.forEach((definition) => {
			const data = definition;

			const wrapper = DOMUtils.createElementWithClass('div', 'category-multi-dropdown');
			const label = DOMUtils.createElementWithClass('div', 'category-dropdown-label');
			label.textContent = definition.label;
			label.addEventListener('click', (event) => {
				event.stopPropagation();
				wrapper.classList.toggle('open');
			});

			const menu = DOMUtils.createElementWithClass('div', 'category-dropdown-menu');
			const sections = this.examViewer.currentExam?.exam_info?.sections ?? [];

			data.sectionIndexes.forEach((sectionIdx) => {
				const section = sections[sectionIdx];
				if (!section?.questions?.length) {
					return;
				}

				const item = document.createElement('div');
				item.className = 'category-menu-item';

				let labelText = '';
				const rawName = (section.section_name || section.section_title || '').trim().replace(/\s+/g, '');
				const matched = rawName.match(/^(問題\d+)/);
				if (matched) {
					labelText = matched[1];
				} else {
					const fallbackId = section.questions.reduce((acc, question) => {
						const numericQuestionId = Number(question.id);
						if (Number.isNaN(numericQuestionId)) {
							return acc;
						}
						return numericQuestionId < acc ? numericQuestionId : acc;
					}, Number(section.questions[0]?.id ?? 1));
					labelText = `問題${Number.isFinite(fallbackId) ? fallbackId : sectionIdx + 1}`;
				}

				item.textContent = labelText;
				item.title = rawName;
				item.dataset.categoryId = definition.id;
				item.dataset.sectionIndex = String(sectionIdx);

				item.addEventListener('click', (event) => {
					event.stopPropagation();
					this.examViewer.stateManager.updateNavigationState(sectionIdx, 0, definition.id);
					wrapper.classList.remove('open');

					const questionList = document.getElementById('question-list');
					if (questionList) {
						questionList.classList.add('hidden');
					}
				});

				menu.appendChild(item);
			});

			wrapper.appendChild(label);
			wrapper.appendChild(menu);
			container.appendChild(wrapper);
		});

		document.addEventListener('click', () => {
			Array.from(container.querySelectorAll('.category-multi-dropdown')).forEach((element) => {
				(element as HTMLElement).classList.remove('open');
			});
		});
	}

	/**
	 * 获取分类显示名称
	 */
	getCategoryDisplayName(catType: string): string {
		const category = this.examViewer.getCategories().find((entry) => entry.id === catType);
		return category?.label || catType;
	}

	/**
	 * 获取分类菜单项
	 */
	getCategoryMenuItems(catType: string): CategoryMenuItem[] {
		if (!this.examViewer.currentExam) {
			return [];
		}

		const sections = this.examViewer.currentExam.exam_info?.sections || [];
		const items: CategoryMenuItem[] = [];

		const categories = this.examViewer.getCategories();
		const category = categories.find((entry) => entry.id === catType);
		if (category && category.sectionIndexes.length > 0) {
			category.sectionIndexes.forEach((sectionIndex) => {
				const section = sections[sectionIndex];
				if (!section) {
					return;
				}

				let label = section.section_name || section.section_title;
				if (label) {
					label = label.replace(/\s+/g, '');
				}
				if (!label) {
					const sectionId = section.section_id;
					if (typeof sectionId === 'number') {
						if (sectionId >= 1.01 && sectionId <= 1.06) {
							label = `词汇/语法 ${sectionId}`;
						} else if (sectionId >= 1.07 && sectionId <= 1.99) {
							label = `阅读${sectionId}`;
						} else if (Math.floor(sectionId) === 2) {
							label = `听力${sectionId}`;
						} else {
							label = `问题${sectionId}`;
						}
					} else {
						label = `第${sectionIndex + 1}部分`;
					}
				}

				items.push({
					label,
					value: `section-${sectionIndex}`
				});
			});
		} else {
			sections.forEach((section, index) => {
				let label = section.section_name || section.section_title;
				if (label) {
					label = label.replace(/\s+/g, '');
				}
				if (!label) {
					label = `第${index + 1}部分`;
				}
				items.push({
					label,
					value: `section-${index}`
				});
			});
		}

		return items;
	}

	/**
	 * 切换分类下拉菜单
	 */
	toggleCategoryDropdown(dropdown: HTMLElement): void {
		const isOpen = dropdown.classList.contains('open');
		document.querySelectorAll('.category-multi-dropdown.open').forEach((element) => {
			(element as HTMLElement).classList.remove('open');
		});
		if (!isOpen) {
			dropdown.classList.add('open');
		}
	}

	/**
	 * 关闭分类下拉菜单
	 */
	closeCategoryDropdown(dropdown: HTMLElement): void {
		dropdown.classList.remove('open');
	}

	/**
	 * 选择分类项
	 */
	selectCategoryItem(catType: string, value: string): void {
		this.examViewer.audioManager.stopAllAudio();

		if (value.startsWith('section-')) {
			const sectionIndex = Number.parseInt(value.replace('section-', ''), 10);
			const totalSections = this.examViewer.currentExam?.exam_info?.sections?.length || 0;
			if (sectionIndex >= 0 && sectionIndex < totalSections) {
				this.examViewer.stateManager.updateNavigationState(sectionIndex, 0, catType);
			}
		}
	}

	/**
	 * 选择分类
	 */
	selectCategory(categoryId: string): void {
		this.examViewer.audioManager.stopAllAudio();
		this.examViewer.stateManager.updateNavigationState(0, 0, categoryId);
	}
}

window.CategoryNavigationManager = CategoryNavigationManager;
