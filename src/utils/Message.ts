import escapeStringRegexp from 'escape-string-regexp';
import { ChatUserstate } from 'tmi.js';
import { IBadge } from '@/renderer/types/IBadge';

export default class Message {
  private channelBadgeList: any;

  private badgeList: any;

  private bttvGlobalEmotes: any;

  private bttvChannelEmotes: any;

  constructor() {
    this.channelBadgeList = [];
    this.badgeList = [];

    // Mappings of the emote code (e.g. ":tf:", "NODDERS", etc) to the ID that can be put into a CDN URL
    this.bttvGlobalEmotes = {};
    this.bttvChannelEmotes = {};
  }

  private async fetchFFZEmotes(): Promise<void> {
    // TODO: emote list to long, think about how to pre fetch the data
  }

  public async fetchBTTVEmotes(channelId: any = null): Promise<void> {
    if (Object.keys(this.bttvGlobalEmotes).length === 0) {
      const globalBTTVEmoteUrl = 'https://api.betterttv.net/3/cached/emotes/global';
      const globalEmotesArray = await fetch(globalBTTVEmoteUrl)
        .then((res) => res.json())
        .catch((e) => {
          // TODO(sshirokov): There's no *great* place to put this error, since the caller will clear
          //                  the screen after this returns to wait for messages.
          console.error('Failed to load BTTV Global Emotes', e);
          return [];
        });
      globalEmotesArray.forEach((emote) => {
        this.bttvGlobalEmotes[emote.code] = emote.id;
      });
    }

    if (Object.keys(this.bttvChannelEmotes).length === 0 && channelId !== null) {
      const channelEmoteURL = `https://api.betterttv.net/3/cached/users/twitch/${channelId}`;
      const channelEmoteInfo = await fetch(channelEmoteURL)
        .then((res) => res.json())
        .catch((e) => {
          // TODO(sshirokov): Same as global :(
          console.error('Failed to load BTTV Channel Emotes', e);
          return {};
        });

      channelEmoteInfo.channelEmotes?.forEach((emote) => {
        this.bttvChannelEmotes[emote.code] = emote.id;
      });
      channelEmoteInfo.sharedEmotes?.forEach((emote) => {
        this.bttvChannelEmotes[emote.code] = emote.id;
      });
    }
  }

  private formatBTTVEmotes(message: string): string {
    const emojiUrlTemplate =
      '<img alt="emote" class="emotes align-middle" src="https://cdn.betterttv.net/emote/%BTTVID%/1x" />';
    function escapeRegExp(string) {
      // Directly out of MDN lmao
      // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions
      return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
    }
    const codeToRegex = (code) => new RegExp(`(^|[^\w])${escapeRegExp(code)}([^\w]|$)`, 'g');

    Object.keys(this.bttvGlobalEmotes).forEach((code) => {
      const codeRegex = codeToRegex(code);

      message = message.replace(
        codeRegex,
        emojiUrlTemplate.replace('%BTTVID%', this.bttvGlobalEmotes[code]),
      );
    });

    Object.keys(this.bttvChannelEmotes).forEach((code) => {
      const codeRegex = codeToRegex(code);

      message = message.replace(
        codeRegex,
        emojiUrlTemplate.replace('%BTTVID%', this.bttvChannelEmotes[code]),
      );
    });

    return message;
  }

  public async formatMessage(message: string, userstate: ChatUserstate): Promise<string> {
    const twitchEmotes: { [p: string]: string[] } | undefined = userstate?.emotes;

    // Update BTTV Emotes if we haven't. We need to do this at least once when we get a message
    // because we need the numeric room id of the channel, and the userstate brings that in
    //
    // TODO(sshirokov): There's like, a very good chance we can do this lookup ahead of time on connect
    //                  just gotta find an endpoint that can exchange a channel name for a channel id
    if (Object.keys(this.bttvChannelEmotes).length === 0) {
      await this.fetchBTTVEmotes(userstate['room-id']);
    }

    return new Promise((resolve) => {
      if (twitchEmotes) {
        const img =
          '<img alt="emote" class="emotes align-middle" src="https://static-cdn.jtvnw.net/emoticons/v1/item/2.0" />';
        const result = {};

        // go through each emote
        Object.keys(twitchEmotes).forEach((key) => {
          // same emotes are stored in on key
          Object.keys(twitchEmotes[key]).forEach((range) => {
            // grab the emote range and split it to two keys
            const emoteCoordinates = twitchEmotes[key][range].split('-');

            const substringFrom = parseInt(emoteCoordinates[0], 10);
            let substringTo: number;

            // check if emote is in first place of the message
            if (parseInt(emoteCoordinates[0], 10) === 0) {
              substringTo = parseInt(emoteCoordinates[1], 10);
            } else {
              substringTo = parseInt(emoteCoordinates[1], 10) - parseInt(emoteCoordinates[0], 10);
            }

            const subString = message.substr(substringFrom, substringTo + 1);

            Object.assign(result, {
              [subString]: img.replace('item', key),
            });
          });
        });

        // go through the result, escape the keys e.g. :) -> \:\), and replace the keys with the image link
        Object.keys(result).forEach((key) => {
          const escaped = escapeStringRegexp(key);
          message = message.replace(new RegExp(escaped, 'g'), result[key]);
        });
      }

      message = this.formatBTTVEmotes(message);

      resolve(message);
    });
  }

  public async getUserBadges(user: ChatUserstate): Promise<IBadge[]> {
    const globalBadgeUrl = 'https://badges.twitch.tv/v1/badges/global/display';
    const channelBadgeUrl = `https://badges.twitch.tv/v1/badges/channels/${user['room-id']}/display?language=en`;
    const badges: { badge: string; key: string }[] = [];

    // cache both badge lists so that we don't need to query it every time we need to parse badges
    if (this.channelBadgeList.length === 0) {
      this.channelBadgeList = await fetch(channelBadgeUrl).then((res) => res.json());
    }

    if (this.badgeList.length === 0) {
      this.badgeList = await fetch(globalBadgeUrl).then((res) => res.json());
    }

    if (user.badges) {
      Object.keys(user.badges).forEach((item) => {
        Object.keys(this.badgeList.badge_sets).forEach((badge) => {
          if (badge === item) {
            const badgeImageUrl = this.badgeList.badge_sets[badge].versions['1']?.image_url_1x;
            if (badgeImageUrl) {
              badges.push({
                badge: badgeImageUrl,
                key: Math.random().toString(36).substring(7),
              });
            }
          }
        });
        Object.keys(this.channelBadgeList.badge_sets).forEach((badge) => {
          if (badge === item) {
            const badgeImageUrl = this.channelBadgeList.badge_sets[badge].versions[
              user.badges![item]!
            ]?.image_url_1x;

            if (badgeImageUrl) {
              badges.push({
                badge: badgeImageUrl,
                key: Math.random().toString(36).substring(7),
              });
            }
          }
        });
      });
    }

    return badges;
  }
}
