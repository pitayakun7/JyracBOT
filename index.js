const { 
    Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, 
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ChannelType, PermissionsBitField, StringSelectMenuBuilder, 
    StringSelectMenuOptionBuilder, ActivityType 
} = require('discord.js');
const express = require('express');

// --- 1. Botの初期化 ---
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ] 
});

// チケット内容の保存用（100文字制限対策）
const ticketMessages = new Map();

// 【設定】自己紹介ステータス
const activities = [
    "JYRAC公式Instaはこちら！▶https://www.instagram.com/jyrac_official/",
    "NSF公式Instaはこちら！▶https://www.instagram.com/2024nsfproject/",
    "ボットに関するお知らせはDiscordID’pitayakun7’まで"
];
const intervalSeconds = 15;

// --- 2. スラッシュコマンド定義 ---
const commands = [
    new SlashCommandBuilder().setName('verify').setDescription('認証パネルを作成します')
        .addRoleOption(o => o.setName('role').setDescription('付与するロール').setRequired(true))
        .addStringOption(o => o.setName('title').setDescription('タイトル').setRequired(false))
        .addStringOption(o => o.setName('description').setDescription('説明文').setRequired(false))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles),
    
    new SlashCommandBuilder().setName('ticket').setDescription('チケットパネルを作成します')
        .addRoleOption(o => o.setName('admin-role').setDescription('管理者ロール').setRequired(true))
        .addStringOption(o => o.setName('title').setDescription('タイトル').setRequired(false))
        .addStringOption(o => o.setName('description').setDescription('説明文').setRequired(false))
        .addStringOption(o => o.setName('panel-desc').setDescription('チケット発行後のメッセージ').setRequired(false))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels),
    
    new SlashCommandBuilder().setName('role-confirmation').setDescription('メンバーの付与ロールを確認します')
        .addUserOption(o => o.setName('target').setDescription('対象のメンバー').setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers),
    
    new SlashCommandBuilder().setName('delete').setDescription('メッセージを指定数削除します（二段階確認）')
        .addIntegerOption(o => o.setName('amount').setDescription('削除する数 (1-100)').setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages),
    
    new SlashCommandBuilder().setName('help').setDescription('コマンドの詳細パネルを表示します')
].map(c => c.toJSON());

// --- 3. 起動時処理 ---
client.once('ready', async () => {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('Bot Ready! すべての機能が正常に読み込まれました。');
    } catch (error) {
        console.error(error);
    }

    let i = 0;
    setInterval(() => {
        client.user.setActivity(activities[i], { type: ActivityType.Custom });
        i = (i + 1) % activities.length;
    }, intervalSeconds * 1000);
});

// Render維持用
const app = express();
app.get('/', (req, res) => res.send('Bot is Active!'));
app.listen(3000);

// --- 4. メイン処理 ---
client.on('interactionCreate', async interaction => {
    if (interaction.replied || interaction.deferred) return;

    // --- A. 権限・ロール順序チェック ---
    if (interaction.isChatInputCommand() || (interaction.isButton() && interaction.customId.includes('delete_yes'))) {
        const botMember = interaction.guild.members.me;
        const executor = interaction.member;

        // 実行者がサーバーオーナーでなく、かつBotの最高ロール以下の順位の場合
        if (executor.roles.highest.position <= botMember.roles.highest.position && interaction.guild.ownerId !== executor.id) {
            const errorMsg = "お持ちのロールに使用権限がありません";
            if (interaction.replied || interaction.deferred) return await interaction.followUp({ content: errorMsg, ephemeral: true });
            return await interaction.reply({ content: errorMsg, ephemeral: true });
        }
    }

    // --- B. スラッシュコマンド応答 ---
    if (interaction.isChatInputCommand()) {
        const { commandName, options } = interaction;

        // /help (詳細テキスト復活版)
        if (commandName === 'help') {
            const embed = new EmbedBuilder()
                .setTitle('📜 コマンドヘルプ')
                .setDescription('詳細を確認したいコマンドを選択してください。')
                .setColor(0x00AE86);
            const select = new StringSelectMenuBuilder().setCustomId('help_select').setPlaceholder('コマンドを選択')
                .addOptions(
                    { label: '/verify', description: '認証パネル', value: 'help_verify' },
                    { label: '/ticket', description: 'チケットパネル', value: 'help_ticket' },
                    { label: '/role-confirmation', description: 'ロール確認', value: 'help_role' },
                    { label: '/delete', description: '一括削除', value: 'help_delete' }
                );
            await interaction.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
        }

        // /delete (リンク表示付き)
        if (commandName === 'delete') {
            const amount = options.getInteger('amount');
            if (amount < 1 || amount > 100) return await interaction.reply({ content: '1〜100で指定してください。', ephemeral: true });

            const messages = await interaction.channel.messages.fetch({ limit: 1 });
            const lastMsg = messages.first();
            let msgDetails = "メッセージが見つかりません";
            if (lastMsg) {
                const link = `https://discord.com/channels/${interaction.guildId}/${interaction.channelId}/${lastMsg.id}`;
                msgDetails = `**発言者:** ${lastMsg.author.tag}\n**内容:** ${lastMsg.content.substring(0, 50) || "（メディア等）"}\n**リンク:** [ここをクリックしてメッセージへ移動](${link})`;
            }

            const embed = new EmbedBuilder()
                .setTitle('⚠️ 削除の最終確認')
                .setDescription(`本当に **${amount}件** 削除しますか？\n\n**削除対象の先頭メッセージ:**\n${msgDetails}`)
                .setColor(0xFF0000)
                .setFooter({ text: "※実行するとリンクは無効になります" });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`bulk_delete_yes_${amount}`).setLabel('削除を実行').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('bulk_delete_no').setLabel('キャンセル').setStyle(ButtonStyle.Secondary)
            );
            await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
        }

        if (commandName === 'verify') {
            const role = options.getRole('role');
            const embed = new EmbedBuilder().setTitle(options.getString('title') ?? 'ロール付与').setDescription(options.getString('description') ?? 'ボタンを押してロールを取得してください。');
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`v_role_${role.id}`).setLabel('✅認証').setStyle(ButtonStyle.Success));
            await interaction.reply({ embeds: [embed], components: [row] });
        }

        if (commandName === 'ticket') {
            const adminRole = options.getRole('admin-role');
            const messageKey = `msg_${Date.now()}`;
            ticketMessages.set(messageKey, options.getString('panel-desc') ?? 'チケット発行ありがとうございます。以下の担当者が来るまでお待ち下さい。');
            const embed = new EmbedBuilder().setTitle(options.getString('title') ?? '問い合わせ').setDescription(options.getString('description') ?? 'ボタンを押してチケットを作成。');
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`tkt_${adminRole.id}_${messageKey}`).setLabel('チケットを発行').setStyle(ButtonStyle.Primary));
            await interaction.reply({ embeds: [embed], components: [row] });
        }

        if (commandName === 'role-confirmation') {
            const target = options.getUser('target');
            const member = await interaction.guild.members.fetch(target.id).catch(() => null);
            if (!member) return await interaction.reply({ content: '取得失敗。', ephemeral: true });
            const roles = member.roles.cache.filter(r => r.name !== '@everyone').map(r => r.name).join('\n') || 'なし';
            await interaction.reply({ content: `**${member.user.tag}** のロール:\n\`\`\`\n${roles}\n\`\`\``, ephemeral: true });
        }
    }

    // --- C. プルダウンメニュー (Help詳細) ---
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'help_select') {
            const selected = interaction.values[0];
            const helpTexts = {
                help_verify: "# /verify\nこのコマンドを使用すると、ボタンを押したユーザーに指定のロールを付与するパネルを作成します。",
                help_ticket: "# /ticket\nこのコマンドを使用すると、チケットを作成するパネルを作成します。管理者のメンションも設定可能です。",
                help_role: "# /role-confirmation\nこのコマンドを使用すると、サーバー内のメンバーが持っているロールを一覧で確認できます。",
                help_delete: "# /delete\nこのコマンドは使用したチャンネルのメッセージを削除します。リンクによる事前の内容確認が可能です。"
            };
            await interaction.update({ content: helpTexts[selected], embeds: [], components: [interaction.message.components[0]] });
        }
    }

    // --- D. ボタン応答 ---
    if (interaction.isButton()) {
        // /delete 実行
        if (interaction.customId.startsWith('bulk_delete_yes_')) {
            const amount = parseInt(interaction.customId.split('_')[3]);
            await interaction.channel.bulkDelete(amount, true).catch(console.error);
            await interaction.update({ content: `✅ ${amount}件のメッセージを削除しました。`, embeds: [], components: [] });
        }
        if (interaction.customId === 'bulk_delete_no') await interaction.update({ content: '削除をキャンセルしました。', embeds: [], components: [] });

        // ロール付与
        if (interaction.customId.startsWith('v_role_')) {
            const roleId = interaction.customId.split('_')[2];
            await interaction.member.roles.add(roleId).catch(console.error);
            await interaction.reply({ content: 'ロールを付与しました！', ephemeral: true });
        }

        // チケット作成
        if (interaction.customId.startsWith('tkt_')) {
            const [_, adminRoleId, messageKey] = interaction.customId.split('_');
            const panelDesc = ticketMessages.get(messageKey) ?? 'お待ちください。';
            const channel = await interaction.guild.channels.create({
                name: `🎫｜${interaction.user.username}`,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                    { id: adminRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                ]
            });
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('delete_confirm').setLabel('チケットを削除').setStyle(ButtonStyle.Danger));
            await channel.send({ content: `${interaction.user} 様\n${panelDesc}\n\n<@&${adminRoleId}>`, components: [row] });
            await interaction.reply({ content: `チケットを作成しました: ${channel}`, ephemeral: true });
        }

        // チケット削除 (二段階確認復活)
        if (interaction.customId === 'delete_confirm') {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('delete_yes').setLabel('本当に削除する').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('delete_no').setLabel('キャンセル').setStyle(ButtonStyle.Secondary)
            );
            await interaction.reply({ content: '本当にこのチケットを削除しますか？', components: [row], ephemeral: true });
        }
        if (interaction.customId === 'delete_yes') await interaction.channel.delete().catch(console.error);
        if (interaction.customId === 'delete_no') await interaction.update({ content: '削除をキャンセルしました。', components: [] });
    }
});

client.login(process.env.DISCORD_TOKEN);
