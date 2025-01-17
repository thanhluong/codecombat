/*
 * decaffeinate suggestions:
 * DS002: Fix invalid constructor
 * DS102: Remove unnecessary code created because of implicit returns
 * DS103: Rewrite code to no longer use __guard__, or convert again using --optional-chaining
 * DS104: Avoid inline assignments
 * DS204: Change includes calls to have a more natural evaluation order
 * DS206: Consider reworking classes to avoid initClass
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/main/docs/suggestions.md
 */
let PlayHeroesModal
require('app/styles/play/modal/play-heroes-modal.sass')
const ModalView = require('views/core/ModalView')
const template = require('app/templates/play/modal/play-heroes-modal')
const buyGemsPromptTemplate = require('app/templates/play/modal/buy-gems-prompt')
const earnGemsPromptTemplate = require('app/templates/play/modal/earn-gems-prompt')
const subscribeForGemsPrompt = require('app/templates/play/modal/subscribe-for-gems-prompt')
const CocoCollection = require('collections/CocoCollection')
const ThangType = require('models/ThangType')
const AudioPlayer = require('lib/AudioPlayer')
const utils = require('core/utils')
const BuyGemsModal = require('views/play/modal/BuyGemsModal')
const CreateAccountModal = require('views/core/CreateAccountModal')
const SubscribeModal = require('views/core/SubscribeModal')
const Purchase = require('models/Purchase')
const createjs = require('lib/createjs-parts')
const ThangTypeConstants = require('lib/ThangTypeConstants')

module.exports = (PlayHeroesModal = (function () {
  PlayHeroesModal = class PlayHeroesModal extends ModalView {
    static initClass () {
      this.prototype.className = 'modal fade play-modal'
      this.prototype.template = template
      this.prototype.id = 'play-heroes-modal'
      this.prototype.trapsFocus = false

      this.prototype.events = {
        'slide.bs.carousel #hero-carousel': 'onHeroChanged',
        'change #option-code-language': 'onCodeLanguageChanged',
        'change #option-code-format': 'onCodeFormatChanged',
        'click #close-modal': 'hide',
        'click #confirm-button': 'saveAndHide',
        'click .unlock-button': 'onUnlockButtonClicked',
        'click .subscribe-button': 'onSubscribeButtonClicked',
        'click .buy-gems-prompt-button': 'onBuyGemsPromptButtonClicked',
        'click .start-subscription-button': 'onSubscribeButtonClicked',
        click: 'onClickedSomewhere'
      }

      this.prototype.shortcuts = {
        'left' () { if (this.heroes.models.length && !this.$el.hasClass('secret')) { return this.$el.find('#hero-carousel').carousel('prev') } },
        'right' () { if (this.heroes.models.length && !this.$el.hasClass('secret')) { return this.$el.find('#hero-carousel').carousel('next') } },
        'enter' () { if (this.visibleHero && !this.visibleHero.locked) { return this.saveAndHide() } }
      }
    }

    constructor (options) {
      super(options)
      this.animateHeroes = this.animateHeroes.bind(this)
      if (options == null) { options = {} }
      this.confirmButtonI18N = options.confirmButtonI18N != null ? options.confirmButtonI18N : 'common.save'
      this.heroes = new CocoCollection([], { model: ThangType })
      this.heroes.url = '/db/thang.type?view=heroes'
      this.heroes.setProjection(['original', 'name', 'slug', 'soundTriggers', 'featureImages', 'gems', 'heroClass', 'description', 'components', 'extendedName', 'shortName', 'unlockLevelName', 'i18n', 'poseImage', 'tier', 'releasePhase', 'ozaria'])
      this.heroes.comparator = 'gems'
      this.listenToOnce(this.heroes, 'sync', this.onHeroesLoaded)
      this.supermodel.loadCollection(this.heroes, 'heroes')
      this.stages = {}
      this.layers = []
      this.session = options.session
      this.initCodeLanguageList(options.hadEverChosenHero)
      this.initCodeFormatList(options.hadEverChosenHero)
      this.heroAnimationInterval = setInterval(this.animateHeroes, 1000)
      this.trackTimeVisible()
      if (options.courseInstanceID) {
        const fetchAceConfig = $.get(`/db/course_instance/${options.courseInstanceID}/classroom?project=aceConfig,members,ownerID`)
        this.supermodel.trackRequest(fetchAceConfig)
        fetchAceConfig.then(classroom => {
          this.classroomAceConfig = classroom.aceConfig
          this.rerenderFooter()
        })
      }
    }

    onHeroesLoaded () {
      this.heroes.reset(this.heroes.filter(hero => !hero.get('ozaria')))
      for (const hero of this.heroes.models) { this.formatHero(hero) }
      this.heroes.reset(this.heroes.filter(hero => !hero.hidden))
      if (me.isStudent() && me.showHeroAndInventoryModalsToStudents()) {
        this.heroes.reset(this.heroes.filter(hero => hero.get('heroClass') === 'Warrior'))
      } else if (me.freeOnly() || application.getHocCampaign()) {
        this.heroes.reset(this.heroes.filter(hero => !hero.locked))
      }
      if (!me.isAdmin()) {
        return this.heroes.reset(this.heroes.filter(hero => hero.get('releasePhase') !== 'beta'))
      }
    }

    formatHero (hero) {
      let allowedHeroes
      hero.name = utils.i18n(hero.attributes, 'extendedName')
      if (hero.name == null) { hero.name = utils.i18n(hero.attributes, 'shortName') }
      if (hero.name == null) { hero.name = utils.i18n(hero.attributes, 'name') }
      hero.description = utils.i18n(hero.attributes, 'description')
      hero.unlockLevelName = utils.i18n(hero.attributes, 'unlockLevelName')
      const original = hero.get('original')
      hero.free = ['captain', 'knight', 'champion', 'duelist'].includes(hero.attributes.slug)
      hero.unlockBySubscribing = ['samurai', 'ninja', 'librarian'].includes(hero.attributes.slug)
      hero.premium = !hero.free && !hero.unlockBySubscribing
      hero.locked = !me.ownsHero(original) && !(hero.unlockBySubscribing && me.isPremium())
      if (me.isStudent() && me.showHeroAndInventoryModalsToStudents() && (hero.get('heroClass') === 'Warrior')) { hero.locked = false }
      hero.purchasable = hero.locked && me.isPremium()
      if (this.options.level && (allowedHeroes = this.options.level.get('allowedHeroes'))) {
        let needle
        hero.restricted = !((needle = hero.get('original'), allowedHeroes.includes(needle)))
      }
      hero.class = (hero.get('heroClass') || 'warrior').toLowerCase()
      hero.stats = hero.getHeroStats()
      const clanHero = _.find(utils.clanHeroes, { thangTypeOriginal: hero.get('original') })
      if (clanHero) {
        let left, needle1
        if ((needle1 = clanHero.clanId, !((left = me.get('clans')) != null ? left : []).includes(needle1))) { hero.hidden = true }
      }
      if (hero.get('original') === ThangTypeConstants.heroes['code-ninja']) {
        hero.hidden = window.location.host !== 'coco.code.ninja'
      }
    }

    currentVisiblePremiumFeature () {
      const isPremium = this.visibleHero && !((this.visibleHero.class === 'warrior') && (this.visibleHero.get('tier') === 0))
      if (isPremium) {
        return {
          viewName: this.id,
          featureName: 'view-hero',
          premiumThang: {
            _id: this.visibleHero.id,
            slug: this.visibleHero.get('slug')
          }
        }
      } else {
        return null
      }
    }

    getRenderData (context) {
      if (context == null) { context = {} }
      context = super.getRenderData(context)
      context.heroes = this.heroes.models
      context.level = this.options.level
      context.codeLanguages = this.codeLanguageList
      context.codeLanguage = this.codeLanguage = this.options?.session?.get('codeLanguage') || me.get('aceConfig')?.language || 'python'
      context.codeFormats = this.codeFormatList
      context.codeFormat = this.codeFormat = me.get('aceConfig')?.codeFormat || 'python'
      context.confirmButtonI18N = this.confirmButtonI18N
      context.visibleHero = this.visibleHero
      context.gems = me.gems()
      return context
    }

    afterInsert () {
      this.updateViewVisibleTimer()
      return super.afterInsert()
    }

    afterRender () {
      let left, left1
      super.afterRender()
      if (!this.supermodel.finished()) { return }
      this.playSound('game-menu-open')
      const heroes = this.heroes.models
      this.$el.find('.hero-indicator').each(function () {
        const heroID = $(this).data('hero-id')
        const hero = _.find(heroes, hero => hero.get('original') === heroID)
        return $(this).find('.hero-avatar').css('background-image', `url(${hero.getPortraitURL()})`).addClass('has-tooltip').tooltip()
      })
      this.canvasWidth = 313 // @$el.find('canvas').width() # unreliable, whatever
      this.canvasHeight = this.$el.find('canvas').height()
      const heroConfig = (left = (left1 = __guard__(this.options != null ? this.options.session : undefined, x => x.get('heroConfig'))) != null ? left1 : me.get('heroConfig')) != null ? left : {}
      const heroIndex = Math.max(0, _.findIndex(heroes, hero => hero.get('original') === heroConfig.thangType))
      this.$el.find(`.hero-item:nth-child(${heroIndex + 1}), .hero-indicator:nth-child(${heroIndex + 1})`).addClass('active')
      this.onHeroChanged({ direction: null, relatedTarget: this.$el.find('.hero-item')[heroIndex] })
      this.$el.find('.hero-stat').addClass('has-tooltip').tooltip()
      this.buildCodeLanguages()
      this.buildCodeFormats()
    }

    rerenderFooter () {
      if (this.visibleHero) {
        this.formatHero(this.visibleHero)
      }
      this.renderSelectors('#hero-footer')
      this.buildCodeLanguages()
      this.buildCodeFormats()
      return this.$el.find('#gems-count-container').toggle(Boolean(this.visibleHero?.purchasable))
    }

    initCodeLanguageList (hadEverChosenHero) {
      if (application.isIPadApp) {
        this.codeLanguageList = [
          { id: 'python', name: `Python (${$.i18n.t('choose_hero.default')})` },
          { id: 'javascript', name: 'JavaScript' }
        ]
      } else {
        this.subscriberCodeLanguageList = [
          { id: 'cpp', name: 'C++' },
          { id: 'java', name: `Java (${$.i18n.t('choose_hero.experimental')})` }
        ]
        this.codeLanguageList = [
          { id: 'python', name: `Python (${$.i18n.t('choose_hero.default')})` },
          { id: 'javascript', name: 'JavaScript' },
          { id: 'coffeescript', name: 'CoffeeScript' },
          { id: 'lua', name: 'Lua' },
          ...this.subscriberCodeLanguageList
        ]
        if (this.options?.session?.get('codeLanguage') || me.get('aceConfig')?.language !== 'coffeescript') {
          // Not really useful to show this any more. Let's get rid of it unless they're currently using it.
          this.codeLanguageList = _.filter(this.codeLanguageList, language => language.id !== 'coffeescript')
        }
      }
    }

    initCodeFormatList (hadEverChosenHero) {
      this.codeFormatList = [
        { id: 'text-code', name: `${$.i18n.t('choose_hero.text_code')} (${$.i18n.t('choose_hero.default')})` },
        { id: 'blocks-and-code', name: `${$.i18n.t('choose_hero.blocks_and_code')}` },
        { id: 'blocks-text', name: `${$.i18n.t('choose_hero.blocks_text')}` },
        { id: 'blocks-icons', name: `${$.i18n.t('choose_hero.blocks_icons')}` },
      ]
    }

    onHeroChanged (e) {
      const heroItem = $(e.relatedTarget)
      let hero = _.find(this.heroes.models, hero => hero.get('original') === heroItem.data('hero-id'))
      if (!hero) { return console.error("Couldn't find hero from heroItem:", heroItem) }
      const heroIndex = heroItem.index()
      hero = this.loadHero(hero)
      this.preloadHero(heroIndex + 1)
      this.preloadHero(heroIndex - 1)
      if (!hero.locked) { this.selectedHero = hero }
      this.visibleHero = hero
      this.rerenderFooter()
      this.trigger('hero-loaded', { hero })
      return this.updateViewVisibleTimer()
    }

    getFullHero (original) {
      const url = `/db/thang.type/${original}/version`
      let fullHero = this.supermodel.getModel(url)
      if (fullHero) {
        return fullHero
      }
      fullHero = new ThangType()
      fullHero.setURL(url)
      fullHero = (this.supermodel.loadModel(fullHero)).model
      return fullHero
    }

    preloadHero (heroIndex) {
      let hero
      if (!(hero = this.heroes.models[heroIndex])) { return }
      return this.loadHero(hero, true)
    }

    loadHero (hero, preloading) {
      const poseImage = hero.get('poseImage')
      if (preloading == null) { preloading = false }
      if (poseImage) {
        $(`.hero-item[data-hero-id='${hero.get('original')}'] canvas`).hide()
        $(`.hero-item[data-hero-id='${hero.get('original')}'] .hero-pose-image`).show().find('img').prop('src', '/file/' + poseImage)
        if (!preloading) { this.playSelectionSound(hero) }
        return hero
      } else {
        throw new Error(`Don't have poseImage for ${hero.get('original')}`)
      }
    }

    animateHeroes () {
      if (!this.visibleHero) { return }
      const heroIndex = Math.max(0, _.findIndex(this.heroes.models, hero => hero.get('original') === this.visibleHero.get('original')))
      const animation = _.sample(['attack', 'move_side', 'move_fore']) // Must be in LayerAdapter default actions.
      return __guardMethod__(__guard__(__guard__(__guard__(this.stages[heroIndex] != null ? this.stages[heroIndex].children : undefined, x2 => x2[0]), x1 => x1.children), x => x[0]), 'gotoAndPlay', o => o.gotoAndPlay(animation))
    }

    playSelectionSound (hero) {
      let sound, sounds, soundTriggers
      if (this.$el.hasClass('secret')) { return }
      if (this.currentSoundInstance != null) {
        this.currentSoundInstance.stop()
      }
      if (!(soundTriggers = utils.i18n(hero.attributes, 'soundTriggers'))) { return }
      if (!(sounds = soundTriggers.selected)) { return }
      if (!(sound = sounds[Math.floor(Math.random() * sounds.length)])) { return }
      const name = AudioPlayer.nameForSoundReference(sound)
      AudioPlayer.preloadSoundReference(sound)
      this.currentSoundInstance = AudioPlayer.playSound(name, 1)
      return this.currentSoundInstance
    }

    buildCodeLanguages () {
      const $select = this.$el.find('#option-code-language')
      if (!$.browser.mobile) {
        $select.fancySelect()
      }
      $select.parent().find('.options li').each(function () {
        const languageName = $(this).text()
        const languageID = $(this).data('value')
        const blurb = $.i18n.t(`choose_hero.${languageID}_blurb`)
        if (languageName.indexOf(blurb) === -1) { // Avoid doubling blurb if this is called 2x
          return $(this).text(`${languageName} - ${blurb}`)
        }
      })
    }

    onCodeLanguageChanged (e) {
      this.codeLanguage = this.$el.find('#option-code-language').val()
      this.codeLanguageChanged = true
      window.tracker?.trackEvent('Campaign changed code language', { category: 'Campaign Hero Select', codeLanguage: this.codeLanguage, levelSlug: this.options.level?.get('slug') })
      if (this.codeFormat === 'blocks-and-code' && ['python', 'javascript'].indexOf(this.codeLanguage) === -1) {
        // Blockly can't support languages like C++/Java. (Some day we'll have Lua.)
        noty({ text: `Can't show blocks and code with ${this.codeLanguage}`, layout: 'bottomCenter', type: 'error', killer: false, timeout: 3000 })
        this.$el.find('#option-code-format').val('text-code').change()
      }
    }

    buildCodeFormats () {
      const $select = this.$el.find('#option-code-format')
      if (!$.browser.mobile) {
        $select.fancySelect()
      }
      $select.parent().find('.options li').each(function () {
        const formatName = $(this).text()
        const formatID = $(this).data('value')
        const blurb = $.i18n.t(`choose_hero.${formatID}_blurb`.replace(/-/g, '_'))
        if (formatName.indexOf(blurb) === -1) { // Avoid doubling blurb if this is called 2x
          return $(this).text(`${formatName} - ${blurb}`)
        }
      })
    }

    onCodeFormatChanged (e) {
      this.codeFormat = this.$el.find('#option-code-format').val()
      this.codeFormatChanged = true
      window.tracker?.trackEvent('Campaign changed code format', { category: 'Campaign Hero Select', codeFormat: this.codeFormat, levelSlug: this.options.level?.get('slug') })
      if (this.codeFormat === 'blocks-and-code' && ['python', 'javascript'].indexOf(this.codeLanguage) === -1) {
        // Blockly can't support languages like C++/Java. (Some day we'll have Lua.)
        noty({ text: `Can't show blocks and code with ${this.codeLanguage}`, layout: 'bottomCenter', type: 'error', killer: false, timeout: 3000 })
        this.$el.find('#option-code-language').val('javascript').change()
      }
    }

    // - Purchasing the hero

    onUnlockButtonClicked (e) {
      e.stopPropagation()
      const button = $(e.target).closest('button')
      const affordable = this.visibleHero.get('gems') <= me.gems()
      if (!affordable) {
        this.playSound('menu-button-click')
        if (!me.freeOnly()) { return this.askToBuyGemsOrSubscribe(button) }
      } else if (button.hasClass('confirm')) {
        let left, left1
        this.playSound('menu-button-unlock-end')
        const purchase = Purchase.makeFor(this.visibleHero)
        purchase.save()

        // - set local changes to mimic what should happen on the server...
        const purchased = (left = me.get('purchased')) != null ? left : {}
        if (purchased.heroes == null) { purchased.heroes = [] }
        purchased.heroes.push(this.visibleHero.get('original'))
        me.set('purchased', purchased)
        me.set('spent', ((left1 = me.get('spent')) != null ? left1 : 0) + this.visibleHero.get('gems'))

        // - ...then rerender visible hero
        const heroEntry = this.$el.find(`.hero-item[data-hero-id='${this.visibleHero.get('original')}']`)
        heroEntry.find('.hero-status-value').attr('data-i18n', 'play.available').i18n()
        this.applyRTLIfNeeded()
        heroEntry.removeClass('locked purchasable')
        this.selectedHero = this.visibleHero
        this.rerenderFooter()

        return Backbone.Mediator.publish('store:hero-purchased', { hero: this.visibleHero, heroSlug: this.visibleHero.get('slug') })
      } else {
        this.playSound('menu-button-unlock-start')
        button.addClass('confirm').text($.i18n.t('play.confirm'))
        return this.$el.one('click', function (e) {
          if (e.target !== button[0]) { return button.removeClass('confirm').text($.i18n.t('play.unlock')) }
        })
      }
    }

    askToSignUp () {
      const createAccountModal = new CreateAccountModal({ supermodel: this.supermodel })
      return this.openModalView(createAccountModal)
    }

    askToBuyGemsOrSubscribe (unlockButton) {
      let popoverTemplate
      this.$el.find('.unlock-button').popover('destroy')
      if (me.isStudent()) {
        popoverTemplate = earnGemsPromptTemplate({})
      } else if (me.canBuyGems()) {
        popoverTemplate = buyGemsPromptTemplate({})
      } else {
        if (!me.hasSubscription()) { // user does not have subscription ask him to subscribe to get more gems, china infra does not have 'buy gems' option
          popoverTemplate = subscribeForGemsPrompt({})
        } else { // user has subscription and yet not enough gems, just ask him to keep playing for more gems
          popoverTemplate = earnGemsPromptTemplate({})
        }
      }

      unlockButton.popover({
        animation: true,
        trigger: 'manual',
        placement: 'left',
        content: ' ', // template has it
        container: this.$el,
        template: popoverTemplate
      }).popover('show')
      const popover = unlockButton.data('bs.popover')
      __guard__(popover != null ? popover.$tip : undefined, x => x.i18n()) // Doesn't work
      return this.applyRTLIfNeeded()
    }

    onBuyGemsPromptButtonClicked (e) {
      if (me.get('anonymous')) { return this.askToSignUp() }
      return this.openModalView(new BuyGemsModal())
    }

    onClickedSomewhere (e) {
      if (this.destroyed) { return }
      return this.$el.find('.unlock-button').popover('destroy')
    }

    onSubscribeButtonClicked (e) {
      this.openModalView(new SubscribeModal())
      return (window.tracker != null ? window.tracker.trackEvent('Show subscription modal', { category: 'Subscription', label: 'hero subscribe modal: ' + ($(e.target).data('heroSlug') || 'unknown') }) : undefined)
    }

    // - Exiting

    saveAndHide () {
      let changed
      if (!me.hasSubscription() && this.subscriberCodeLanguageList.find(l => l.id === this.codeLanguage) && !me.isStudent()) {
        this.openModalView(new SubscribeModal())
        if (window.tracker != null) {
          window.tracker.trackEvent('Show subscription modal', { category: 'Subscription', label: 'hero subscribe modal: experimental language' })
        }
        return
      }

      let hero = this.selectedHero != null ? this.selectedHero.get('original') : undefined
      if ((this.visibleHero != null ? this.visibleHero.loaded : undefined) && !this.visibleHero.locked) { if (hero == null) { hero = this.visibleHero != null ? this.visibleHero.get('original') : undefined } }
      if (!hero) {
        console.error('Somehow we tried to hide without having a hero selected yet...')
        noty({
          text: 'Error: hero not loaded. If this keeps happening, please report the bug.',
          layout: 'topCenter',
          timeout: 10000,
          type: 'error'
        })
        return
      }

      if (this.session) {
        changed = this.updateHeroConfig(this.session, hero)
        if (this.session.get('codeLanguage') !== this.codeLanguage) {
          this.session.set('codeLanguage', this.codeLanguage)
          changed = true
        }
        // Backbone.Mediator.publish 'tome:change-language', language: @codeLanguage, reload: true  # We'll reload the PlayLevelView instead.

        if (changed) { this.session.patch() }
      }

      changed = this.updateHeroConfig(me, hero)
      const aceConfig = _.clone(me.get('aceConfig')) || {}
      if (this.codeLanguage !== aceConfig.language) {
        aceConfig.language = this.codeLanguage
        me.set('aceConfig', aceConfig)
        changed = true
      }
      if (this.codeFormat !== aceConfig.codeFormat) {
        aceConfig.codeFormat = this.codeFormat
        me.set('aceConfig', aceConfig)
        changed = true
      }

      if (changed) { me.patch() }

      this.hide()
      return (typeof this.trigger === 'function' ? this.trigger('confirm-click', { hero: this.selectedHero }) : undefined)
    }

    updateHeroConfig (model, hero) {
      if (!hero) { return false }
      const heroConfig = _.clone(model.get('heroConfig')) || {}
      if (heroConfig.thangType !== hero) {
        heroConfig.thangType = hero
        model.set('heroConfig', heroConfig)
        return true
      }
    }

    onHidden () {
      super.onHidden()
      return this.playSound('game-menu-close')
    }

    destroy () {
      clearInterval(this.heroAnimationInterval)
      for (const heroIndex in this.stages) {
        const stage = this.stages[heroIndex]
        createjs.Ticker.removeEventListener('tick', stage)
        stage.removeAllChildren()
      }
      for (const layer of this.layers) { layer.destroy() }
      return super.destroy()
    }
  }
  PlayHeroesModal.initClass()
  return PlayHeroesModal
})())

function __guard__ (value, transform) {
  return (typeof value !== 'undefined' && value !== null) ? transform(value) : undefined
}
function __guardMethod__ (obj, methodName, transform) {
  if (typeof obj !== 'undefined' && obj !== null && typeof obj[methodName] === 'function') {
    return transform(obj, methodName)
  } else {
    return undefined
  }
}
