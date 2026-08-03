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
	section_id?: string | number;
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
	disabled?: boolean;
}

interface CategoryNavigationExamViewer {
	currentCategory: string | null;
	currentExam?: {
		family?: string;
		exam_info?: {
			family?: string;
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
			(slot as HTMLElement).dataset.categoryId = category.id;
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
				if (item.disabled) {
					menuItem.classList.add('disabled');
				}
				menuItem.textContent = item.label;
				menuItem.addEventListener('click', () => {
					if (item.disabled) {
						return;
					}
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
		this.syncActiveCategory();

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

	/** 让工具栏只高亮当前正在作答的分类。 */
	syncActiveCategory(): void {
		const currentCategory = this.examViewer.currentCategory;
		document.querySelectorAll<HTMLElement>('#exam-controls .category-slot').forEach((slot) => {
			const active = Boolean(currentCategory) && slot.dataset.categoryId === currentCategory;
			slot.querySelector('.category-dropdown-label')?.classList.toggle('active', active);
		});
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
			if (this.isEjuExam()) {
				return this.getEjuQuestionMenuItems(category);
			}
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

	private getEjuQuestionMenuItems(category: CategoryEntry): CategoryMenuItem[] {
		const sections = this.examViewer.currentExam?.exam_info?.sections || [];
		const items: CategoryMenuItem[] = [];

		category.sectionIndexes.forEach((sectionIndex) => {
			const section = sections[sectionIndex];
			const questions = section?.questions || [];
			const mergedSectionType = category.id === 'writing_reading'
				? String(section?.section_type || '').toLowerCase()
				: '';
			if (questions.length === 0) {
				items.push({
					label: '暂无题目',
					value: `section-${sectionIndex}-empty`,
					disabled: true
				});
				return;
			}

			questions.forEach((question, questionIndex) => {
				const questionLabel = this.getEjuQuestionLabel(question, questionIndex);
				const label = mergedSectionType === 'writing'
					? '記述'
					: mergedSectionType === 'reading'
						? `読解 ${questionLabel}`
						: questionLabel;
				items.push({
					label,
					value: `question-${sectionIndex}-${questionIndex}`
				});
			});
		});

		return items;
	}

	private getEjuQuestionLabel(question: CategorySectionQuestion, questionIndex: number): string {
		const ejuNo = question.eju_question_no ?? question.eju_answer_no;
		if (typeof ejuNo === 'number' && Number.isFinite(ejuNo)) {
			return `${ejuNo}番`;
		}
		if (typeof ejuNo === 'string' && ejuNo.trim()) {
			return `${ejuNo.trim()}番`;
		}
		return `${questionIndex + 1}番`;
	}

	private isEjuExam(): boolean {
		const exam = this.examViewer.currentExam;
		const family = String(exam?.family || exam?.exam_info?.family || '').toLowerCase();
		return family === 'eju';
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
		} else if (value.startsWith('question-')) {
			const [, rawSectionIndex, rawQuestionIndex] = value.split('-');
			const sectionIndex = Number.parseInt(rawSectionIndex || '', 10);
			const questionIndex = Number.parseInt(rawQuestionIndex || '', 10);
			const totalSections = this.examViewer.currentExam?.exam_info?.sections?.length || 0;
			const section = this.examViewer.currentExam?.exam_info?.sections?.[sectionIndex];
			if (
				sectionIndex >= 0 &&
				sectionIndex < totalSections &&
				questionIndex >= 0 &&
				questionIndex < (section?.questions?.length || 0)
			) {
				this.examViewer.stateManager.updateNavigationState(sectionIndex, questionIndex, catType);
			}
		}
	}

	/**
	 * 选择分类
	 */
	selectCategory(categoryId: string): void {
		this.examViewer.audioManager.stopAllAudio();
		const categories = this.examViewer.getCategories();
		const mergedEjuCategory = (categoryId === 'writing' || categoryId === 'reading')
			? categories.find((entry) => entry.id === 'writing_reading')
			: undefined;
		const category = categories.find((entry) => entry.id === categoryId) || mergedEjuCategory;
		const sections = this.examViewer.currentExam?.exam_info?.sections || [];
		const preferredSectionIndex = mergedEjuCategory?.sectionIndexes.find((index) => {
			return String(sections[index]?.section_type || '').toLowerCase() === categoryId;
		});
		const sectionIndex = preferredSectionIndex ?? category?.sectionIndexes.find((index) => {
			const section = sections[index];
			return Array.isArray(section?.questions) && section.questions.length > 0;
		});
		this.examViewer.stateManager.updateNavigationState(sectionIndex ?? 0, 0, category?.id || categoryId);
	}
}

window.CategoryNavigationManager = CategoryNavigationManager;
