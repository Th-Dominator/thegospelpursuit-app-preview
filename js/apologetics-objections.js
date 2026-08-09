/* Objections & Apologetics — real objections grouped by the perspective that
   actually raises them, stated at their strongest (steelmanned, never a straw
   man). Opening one asks the backend `objection-study` endpoint for a full,
   fair analysis. These are representative starting points; the user can also
   type any objection of their own. */
var APOLO_PERSPECTIVES = [
  {
    id: 'atheist',
    label: 'Atheist / agnostic',
    icon: '⚛',
    blurb: 'Objections from a naturalistic or skeptical starting point.',
    objections: [
      'If God is all-good and all-powerful, the amount of gratuitous suffering in the world is strong evidence he does not exist.',
      'Extraordinary claims like the resurrection require extraordinary evidence, and ancient testimony simply is not enough.',
      'Belief in God is a hypothesis science has made unnecessary; we explain more every year without invoking him.',
      'If God wanted everyone to believe, he could make himself obvious; his hiddenness is better explained by his non-existence.',
      'Morality is a product of evolution and culture, so you do not need God to be good or to ground ethics.',
      'The existence of thousands of religions, each sure it is right, suggests all of them are human inventions.',
      'Miracles violate the laws of nature, and it is always more likely that the report is mistaken than that a law was broken.'
    ]
  },
  {
    id: 'jewish',
    label: 'Jewish',
    icon: '✡',
    blurb: 'Objections from Judaism to Christian claims about Jesus and the Scriptures.',
    objections: [
      'Jesus did not fulfill the messianic prophecies: there is no world peace, no rebuilt temple, and no ingathering of the exiles.',
      'Isaiah 7:14 uses almah (young woman), not betulah (virgin); the virgin birth rests on a mistranslation.',
      'The suffering servant of Isaiah 53 is national Israel, as the surrounding chapters make clear, not an individual messiah.',
      'The doctrine of the Trinity compromises the absolute oneness of God confessed in the Shema.',
      'A dying and rising messiah who is also God is foreign to the Hebrew Scriptures and to Israel’s expectation.',
      'The Torah is an everlasting covenant, so a new covenant that sets aside its commands cannot be from the same God.'
    ]
  },
  {
    id: 'muslim',
    label: 'Muslim',
    icon: '☪',
    blurb: 'Objections from Islam to the Bible, the Trinity, and the crucifixion.',
    objections: [
      'The Bible has been corrupted over time (tahrif); the original revelation to Jesus was lost or altered.',
      'The Qur’an teaches that Jesus was not crucified but that it only appeared so (Surah 4:157).',
      'The Trinity divides the oneness of God (tawhid) and amounts to shirk, associating partners with God.',
      'Jesus never plainly said "I am God, worship me"; his divinity was developed later by the church.',
      'Jesus foretold a coming helper, the Paraclete, whom Muslims identify as Muhammad (John 14–16).',
      'If Jesus is God, why did he pray, say the Father is greater, and not know the hour of the last day?'
    ]
  },
  {
    id: 'religions',
    label: 'Other religious perspectives',
    icon: '☸',
    blurb: 'Objections from pluralism and other world religions.',
    objections: [
      'All religions are paths up the same mountain; the Christian claim to be the only way is arrogant and divisive.',
      'A loving God would not send sincere, devout people of other faiths to hell for being born in the wrong place.',
      'Religious experience is remarkably similar across traditions, which suggests one underlying reality behind all of them.',
      'The doctrine of an eternal, embodied self and its salvation ignores the deeper insight that the self is an illusion.'
    ]
  },
  {
    id: 'traditions',
    label: 'Catholic / Orthodox / Protestant',
    icon: '⛪',
    blurb: 'Points of genuine disagreement between the major Christian traditions.',
    objections: [
      'Sola scriptura is self-refuting: the Bible never lists its own table of contents, and it was the Church that recognized the canon.',
      'Justification is by faith and works together, as James 2 says a person is justified by works and not by faith alone.',
      'Christ founded his Church on Peter (Matthew 16:18) with a visible authority and succession, not on Scripture alone.',
      'The Marian doctrines and the veneration of saints have deep roots in the ancient Church, not just late medieval piety.',
      'The Eucharist is truly the body and blood of Christ, as the early Fathers and John 6 affirm, not merely a symbol.',
      'Icons and images are a legitimate part of worship since the incarnation makes the invisible God depictable.'
    ]
  },
  {
    id: 'internal',
    label: 'Internal Christian debates',
    icon: '☩',
    blurb: 'Theological disagreements among Christians who share the core faith.',
    objections: [
      'Does God unconditionally elect who will be saved (Calvinism), or does saving grace depend on free human response (Arminianism)?',
      'Should baptism be reserved for professing believers, or does the covenant include the infant children of believers?',
      'Are the miraculous gifts (tongues, prophecy, healing) for the church today, or did they cease with the apostles?',
      'Does Genesis 1 require a young earth and a literal six days, or is it compatible with an old earth and evolution?',
      'What is the right reading of the end times: premillennial, amillennial, or postmillennial?',
      'Should women be ordained to teaching and governing office in the church, or is that role reserved for qualified men?'
    ]
  }
];
